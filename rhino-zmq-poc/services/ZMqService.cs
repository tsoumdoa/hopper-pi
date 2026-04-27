using System;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
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
        private readonly GH_Document _doc;
        private readonly UiRequestDispatcher _requestDispatcher = new UiRequestDispatcher();
        private readonly ConcurrentQueue<(string topic, string json)> _publishQueue = new ConcurrentQueue<(string, string)>();

        public event Action<GhJobStatus> OnJobStatus;
        public event Action<string> OnDebugLog;
        public event Action<string> OnJobReceived;

        public ZMqService(JobQueue jobQueue, GH_Document doc)
        {
            _jobQueue = jobQueue;
            _doc = doc;
            _requestDispatcher.Register("listAllComponents", new ListAllComponentsHandler());
            _requestDispatcher.Register("getCurrentCanvas", new GetCurrentCanvasHandler());
            _requestDispatcher.Register("getCanvasErrors", new GetCanvasErrorsHandler());
            _requestDispatcher.Register("listScriptParams", new ListScriptParamsHandler());
            _requestDispatcher.Register("getScriptCode", new GetScriptCodeHandler());
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
                    if (!_pullSocket.TryReceiveFrameString(TimeSpan.FromMilliseconds(300), out message))
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
                    string message;
                    if (!_repSocket.TryReceiveFrameString(TimeSpan.FromMilliseconds(300), out message))
                    {
                        continue;
                    }
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

                if (_requestDispatcher.TryDispatch(type, _doc, doc.RootElement, out var response))
                    return Utilities.RunOnUiThread(() => response);

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
            _commandTask?.Wait(TimeSpan.FromMilliseconds(500));
            _repTask?.Wait(TimeSpan.FromMilliseconds(500));
            _pubSocket?.Dispose();
            _pullSocket?.Dispose();
            _repSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }
}
