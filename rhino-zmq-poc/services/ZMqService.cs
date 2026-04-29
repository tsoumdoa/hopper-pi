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
        private const string PullEndpoint = "tcp://*:5556";

        private PublisherSocket _pubSocket;
        private PullSocket _pullSocket;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _commandTask;
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

                _pullSocket = new PullSocket();
                _pullSocket.Bind(PullEndpoint);
                DebugLog($"[PULL] Bound to {PullEndpoint}");

                _commandTask = Task.Run(() => CommandLoop(_cts.Token));
            }
            catch (Exception ex)
            {
                DebugLog($"[ZMQ] Start error: {ex.Message}");
            }
        }

        private void CommandLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    string message;
                    if (!_pullSocket.TryReceiveFrameString(TimeSpan.FromSeconds(1), out message))
                    {
                        DrainPublishQueue();
                        continue;
                    }

                    DebugLog($"[PULL] Received: {message}");

                    ProcessCommand(message);

                    DrainPublishQueue();
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[PULL] Error: {ex.Message}");
                }
            }
        }

        private void ProcessCommand(string message)
        {
            try
            {
                var request = JsonSerializer.Deserialize<SubmitJobRequest>(message);
                if (request == null || request.Command == null)
                {
                    DebugLog("[PULL] Invalid request: null or missing command");
                    return;
                }

                if (request.Type != "submitJob")
                {
                    DebugLog($"[PULL] Unknown request type: {request.Type}");
                    return;
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

                DebugLog($"[PULL] Enqueued job {job.JobId} ({commandId})");
            }
            catch (Exception ex)
            {
                DebugLog($"[PULL] Process error: {ex.Message}");
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

        private void DebugLog(string msg)
        {
            OnDebugLog?.Invoke(msg);
        }

        public void Dispose()
        {
            _cts.Cancel();
            _commandTask?.Wait(TimeSpan.FromSeconds(2));
            _pubSocket?.Dispose();
            _pullSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }
}
