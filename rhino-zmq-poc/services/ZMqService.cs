using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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
        private const string RepEndpoint = "tcp://*:5557";

        private PublisherSocket _pubSocket;
        private PullSocket _pullSocket;
        private ResponseSocket _repSocket;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _commandTask;
        private Task _repTask;
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

                _repSocket = new ResponseSocket();
                _repSocket.Bind(RepEndpoint);
                DebugLog($"[REP] Bound to {RepEndpoint}");

                _commandTask = Task.Run(() => CommandLoop(_cts.Token));
                _repTask = Task.Run(() => RepLoop(_cts.Token));
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

        private void RepLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    string message = _repSocket.ReceiveFrameString();
                    DebugLog($"[REP] Received: {message}");

                    var response = HandleRequest(message);

                    _repSocket.SendFrame(response);
                    DebugLog($"[REP] Sent response");
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[REP] Error: {ex.Message}");
                }
            }
        }

        private string HandleRequest(string message)
        {
            try
            {
                using var doc = JsonDocument.Parse(message);
                var type = doc.RootElement.GetProperty("type").GetString();

                if (type == "listAllComponents")
                {
                    var mockComponents = new List<GhComponentInfo>
                    {
                        new GhComponentInfo { Name = "Point", Guid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890", Category = "Vector", Subcategory = "Point", Description = "Construct a 3D point from xyz coordinates" },
                        new GhComponentInfo { Name = "Line", Guid = "b2c3d4e5-f6a7-8901-bcde-f12345678901", Category = "Curve", Subcategory = "Primitive", Description = "Create a line between two points" },
                        new GhComponentInfo { Name = "Circle", Guid = "c3d4e5f6-a7b8-9012-cdef-123456789012", Category = "Curve", Subcategory = "Primitive", Description = "Define a circle by base plane and radius" },
                        new GhComponentInfo { Name = "Number Slider", Guid = "d4e5f6a7-b8c9-0123-defa-234567890123", Category = "Params", Subcategory = "Input", Description = "Numeric slider for user input values" },
                        new GhComponentInfo { Name = "Panel", Guid = "e5f6a7b8-c9d0-1234-efab-345678901234", Category = "Params", Subcategory = "Input", Description = "Data display and text container" },
                    };

                    var response = new ListAllComponentsResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Components = mockComponents
                    };

                    return JsonSerializer.Serialize(response);
                }

                return JsonSerializer.Serialize(new { error = $"Unknown request type: {type}" });
            }
            catch (Exception ex)
            {
                DebugLog($"[REP] HandleRequest error: {ex.Message}");
                return JsonSerializer.Serialize(new { error = ex.Message });
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
            _repTask?.Wait(TimeSpan.FromSeconds(2));
            _pubSocket?.Dispose();
            _pullSocket?.Dispose();
            _repSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }
}
