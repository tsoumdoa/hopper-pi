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
        private const int StartMaxAttempts = 5;

        private PublisherSocket _pubSocket;
        private PullSocket _pullSocket;
        private ResponseSocket _repSocket;
        private CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _commandTask;
        private Task _repTask;
        private int _stopped;
        private readonly JobQueue _jobQueue;
        private readonly GH_Document _doc;
        private readonly UiRequestDispatcher _requestDispatcher = new UiRequestDispatcher();
        private readonly ConcurrentQueue<(string topic, string json)> _publishQueue = new ConcurrentQueue<(string, string)>();
        private readonly Action<GhJobStatus> _jobStatusHandler;

        public event Action<GhJobStatus> OnJobStatus;
        public event Action<string> OnDebugLog;
        public event Action<string> OnJobReceived;

        public bool IsRunning { get; private set; }

        public ZMqService(JobQueue jobQueue, GH_Document doc)
        {
            _jobQueue = jobQueue;
            _doc = doc;
            _requestDispatcher.Register("listAllComponents", new ListAllComponentsHandler());
            _requestDispatcher.Register("getCurrentCanvas", new GetCurrentCanvasHandler());
            _requestDispatcher.Register("getCanvasErrors", new GetCanvasErrorsHandler());
            _requestDispatcher.Register("listScriptParams", new ListScriptParamsHandler());
            _requestDispatcher.Register("getScriptCode", new GetScriptCodeHandler());
            _jobStatusHandler = status =>
            {
                OnJobStatus?.Invoke(status);
                EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            };
            _jobQueue.OnStatusChanged += _jobStatusHandler;
        }

        public void Start()
        {
            for (var attempt = 1; attempt <= StartMaxAttempts; attempt++)
            {
                PublisherSocket pub = null;
                PullSocket pull = null;
                ResponseSocket rep = null;

                try
                {
                    pub = BindSocket(new PublisherSocket(), PubEndpoint);
                    pull = BindSocket(new PullSocket(), PullEndpoint);
                    rep = BindSocket(new ResponseSocket(), RepEndpoint);

                    _pubSocket = pub;
                    _pullSocket = pull;
                    _repSocket = rep;

                    var token = _cts.Token;
                    _commandTask = Task.Run(() => CommandLoop(token));
                    _repTask = Task.Run(() => RepLoop(token));
                    IsRunning = true;
                    DebugLog($"[ZMQ] Started on attempt {attempt}");
                    return;
                }
                catch (Exception ex)
                {
                    IsRunning = false;
                    ReleaseSocket(pub, PubEndpoint);
                    ReleaseSocket(pull, PullEndpoint);
                    ReleaseSocket(rep, RepEndpoint);
                    _pubSocket = null;
                    _pullSocket = null;
                    _repSocket = null;

                    if (attempt < StartMaxAttempts && IsAddressInUse(ex))
                    {
                        DebugLog($"[ZMQ] Start error (attempt {attempt}/{StartMaxAttempts}): {ex.Message}; retrying...");
                        continue;
                    }

                    DebugLog($"[ZMQ] Start error: {ex.Message}");
                    return;
                }
            }
        }

        private static T BindSocket<T>(T socket, string endpoint) where T : NetMQSocket
        {
            socket.Options.Linger = TimeSpan.Zero;
            socket.Bind(endpoint);
            return socket;
        }

        private static bool IsAddressInUse(Exception ex)
        {
            for (var current = ex; current != null; current = current.InnerException)
            {
                if (current is AddressAlreadyInUseException)
                    return true;
            }
            return false;
        }

        private void CommandLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    string message;
                    if (_pullSocket == null ||
                        !_pullSocket.TryReceiveFrameString(TimeSpan.FromMilliseconds(100), out message))
                    {
                        DrainPublishQueue();
                        continue;
                    }

                    DebugLog($"[PULL] Received: {message}");
                    ProcessCommand(message);
                    DrainPublishQueue();
                }
                catch (ObjectDisposedException) when (ct.IsCancellationRequested)
                {
                    break;
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
                    if (_repSocket == null ||
                        !_repSocket.TryReceiveFrameString(TimeSpan.FromMilliseconds(100), out message))
                    {
                        continue;
                    }

                    DebugLog($"[REP] Received: {message}");

                    if (ct.IsCancellationRequested)
                        break;

                    var response = HandleRequest(message);

                    if (ct.IsCancellationRequested || _repSocket == null)
                        break;

                    _repSocket.SendFrame(response);
                    DebugLog("[REP] Sent response");
                }
                catch (ObjectDisposedException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[REP] Error: {ex.Message}");
                }
            }
        }

        private string HandleRequest(string message)
        {
            if (_cts.IsCancellationRequested)
                return JsonSerializer.Serialize(new { error = "Service shutting down" });

            try
            {
                using var doc = JsonDocument.Parse(message);
                var type = doc.RootElement.GetProperty("type").GetString();

                if (_requestDispatcher.TryDispatch(type, _doc, doc.RootElement, out var response))
                {
                    if (_cts.IsCancellationRequested)
                        return JsonSerializer.Serialize(new { error = "Service shutting down" });

                    return Utilities.RunOnUiThread(() => response, TimeSpan.FromSeconds(5));
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
                    if (_pubSocket == null)
                        return;

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

        public void StopFast()
        {
            if (Interlocked.Exchange(ref _stopped, 1) != 0)
                return;

            IsRunning = false;
            _cts.Cancel();

            if (_jobStatusHandler != null)
                _jobQueue.OnStatusChanged -= _jobStatusHandler;

            ReleaseSocket(_pubSocket, PubEndpoint);
            ReleaseSocket(_pullSocket, PullEndpoint);
            ReleaseSocket(_repSocket, RepEndpoint);
            _pubSocket = null;
            _pullSocket = null;
            _repSocket = null;

            var commandTask = _commandTask;
            var repTask = _repTask;
            var cts = _cts;
            _commandTask = null;
            _repTask = null;
            _cts = null;

            _ = Task.Run(() => DrainBackgroundTasks(commandTask, repTask, cts));
        }

        private static void DrainBackgroundTasks(Task commandTask, Task repTask, CancellationTokenSource cts)
        {
            try
            {
                commandTask?.Wait(TimeSpan.FromSeconds(2));
                repTask?.Wait(TimeSpan.FromSeconds(2));
            }
            catch
            {
                // Best effort while shutting down.
            }
            finally
            {
                try { cts?.Dispose(); } catch { }
            }
        }

        public void Dispose()
        {
            StopFast();
        }

        private static void ReleaseSocket(NetMQSocket socket, string endpoint)
        {
            if (socket == null)
                return;

            try
            {
                socket.Unbind(endpoint);
            }
            catch
            {
                // Endpoint may already be unbound.
            }

            try
            {
                socket.Dispose();
            }
            catch
            {
                // Best effort during shutdown.
            }
        }
    }
}
