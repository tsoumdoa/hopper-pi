using System;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NetMQ;
using NetMQ.Sockets;

namespace rhino_zmq_poc
{
    public class ZMqService : IDisposable
    {
        private const string PubEndpoint = "tcp://*:5555";
        private const string RouterEndpoint = "tcp://*:5556";

        private PublisherSocket _pubSocket;
        private RouterSocket _routerSocket;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _routerTask;
        private readonly JobQueue _jobQueue;
        private readonly ConcurrentQueue<(string topic, string json)> _publishQueue = new ConcurrentQueue<(string, string)>();

        public event Action<GhJobStatus> OnJobStatus;
        public event Action<string> OnDebugLog;
        public event Action<string> OnJobReceived;

        public ZMqService(JobQueue jobQueue)
        {
            _jobQueue = jobQueue;
            _jobQueue.OnStatusChanged += status =>
            {
                OnJobStatus?.Invoke(status);
                EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            };
        }

        public void Start()
        {
            try
            {
                _pubSocket = new PublisherSocket();
                _pubSocket.Bind(PubEndpoint);
                DebugLog($"[PUB] Bound to {PubEndpoint}");

                _routerSocket = new RouterSocket();
                _routerSocket.Bind(RouterEndpoint);
                DebugLog($"[ROUTER] Bound to {RouterEndpoint}");

                _routerTask = Task.Run(() => RouterLoop(_cts.Token));
            }
            catch (Exception ex)
            {
                DebugLog($"[ZMQ] Start error: {ex.Message}");
            }
        }

        private void RouterLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    byte[] identity;
                    if (!_routerSocket.TryReceiveFrameBytes(TimeSpan.FromSeconds(1), out identity))
                    {
                        DrainPublishQueue();
                        continue;
                    }

                    var message = _routerSocket.ReceiveFrameString();
                    DebugLog($"[ROUTER] Received: {message}");

                    var response = ProcessRequest(message);
                    _routerSocket.SendFrame(identity, true);
                    _routerSocket.SendFrame(response);
                    DebugLog($"[ROUTER] Sent: {response}");

                    DrainPublishQueue();
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[ROUTER] Error: {ex.Message}");
                }
            }
        }

        private void DrainPublishQueue()
        {
            while (_publishQueue.TryDequeue(out var item))
            {
                try
                {
                    _pubSocket.SendFrame(item.topic, true);
                    _pubSocket.SendFrame(item.json);
                    DebugLog($"[PUB] Published {item.topic}");
                }
                catch (Exception ex)
                {
                    DebugLog($"[PUB] Publish error: {ex.Message}");
                }
            }
        }

        private void EnqueuePublish(string topic, string json)
        {
            _publishQueue.Enqueue((topic, json));
        }

        private string ProcessRequest(string message)
        {
            try
            {
                var request = JsonSerializer.Deserialize<SubmitJobRequest>(message);
                if (request == null || request.Command == null)
                {
                    return JsonSerializer.Serialize(new SubmitJobResponse
                    {
                        Status = "error",
                        Error = "Invalid request"
                    });
                }

                if (request.Type != "submitJob")
                {
                    return JsonSerializer.Serialize(new SubmitJobResponse
                    {
                        Status = "error",
                        Error = $"Unknown request type: {request.Type}"
                    });
                }

                string commandId = $"cmd-{Guid.NewGuid().ToString()[..8]}";

                var job = new Job
                {
                    JobId = request.JobId,
                    CommandId = commandId,
                    Command = request.Command
                };

                _jobQueue.Enqueue(job);

                OnJobReceived?.Invoke($"{job.JobId}|{job.CommandId}|{job.Command.Action}");

                return JsonSerializer.Serialize(new SubmitJobResponse
                {
                    Status = "ok",
                    JobId = job.JobId,
                    CommandId = commandId,
                    QueuedAt = job.QueuedAt
                });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new SubmitJobResponse
                {
                    Status = "error",
                    Error = ex.Message
                });
            }
        }

        public void PublishXmlEvent(string docName, string xml)
        {
            if (_pubSocket == null) return;

            var evt = new GhEventXml
            {
                DocName = docName,
                Xml = xml,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            EnqueuePublish("gh.event.xml", JsonSerializer.Serialize(evt));
            DebugLog($"[PUB] Queued gh.event.xml for {docName}");
        }

        private void PublishJobStatus(GhJobStatus status)
        {
            if (_pubSocket == null) return;

            EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            DebugLog($"[PUB] Queued gh.job.status: {status.State}");
        }

        private void DebugLog(string msg)
        {
            OnDebugLog?.Invoke(msg);
        }

        public void Dispose()
        {
            _cts.Cancel();
            _routerTask?.Wait(TimeSpan.FromSeconds(2));
            _pubSocket?.Dispose();
            _routerSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }
}