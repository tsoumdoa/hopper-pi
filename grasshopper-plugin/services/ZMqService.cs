using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
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
        private const string LoopbackHost = "127.0.0.1";
        private const int DefaultPubPort = 5555;
        private const int DefaultPullPort = 5556;
        private const int DefaultRepPort = 5557;
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
        private string _pubEndpoint;
        private string _pullEndpoint;
        private string _repEndpoint;
        private string _connectionToken;
        private string _instanceId;

        public event Action<GhJobStatus> OnJobStatus;
        public event Action<string> OnDebugLog;
        public event Action<string> OnJobReceived;

        public bool IsRunning { get; private set; }
        public ConnectionProfile Profile { get; private set; }

        public ZMqService(JobQueue jobQueue, GH_Document doc)
        {
            _jobQueue = jobQueue;
            _doc = doc;
            _requestDispatcher.Register("listAllComponents", new ListAllComponentsHandler());
            _requestDispatcher.Register("getCurrentCanvas", new GetCurrentCanvasHandler());
            _requestDispatcher.Register("getCanvasErrors", new GetCanvasErrorsHandler());
            _requestDispatcher.Register("listScriptParams", new ListScriptParamsHandler());
            _requestDispatcher.Register("getScriptCode", new GetScriptCodeHandler());
            _requestDispatcher.Register("runRhinoScript", new RunRhinoScriptHandler());
            _requestDispatcher.Register("queryRhinoObjects", new QueryRhinoObjectsHandler());
            _requestDispatcher.Register("captureRhinoView", new CaptureRhinoViewHandler());
            _requestDispatcher.Register("controlRhinoView", new ControlRhinoViewHandler());
            _requestDispatcher.Register("getParamRhinoGeometry", new GetParamRhinoGeometryHandler());
            _jobStatusHandler = status =>
            {
                OnJobStatus?.Invoke(status);
                EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            };
            _jobQueue.OnStatusChanged += _jobStatusHandler;
        }

        public void Start()
        {
            _connectionToken = ConnectionProfileStore.LoadOrCreateToken();
            _instanceId = Guid.NewGuid().ToString("N");

            if (TryStart(DefaultEndpoints(), "default"))
                return;

            for (var attempt = 1; attempt <= StartMaxAttempts; attempt++)
            {
                if (TryStart(RandomEndpoints(), $"dynamic attempt {attempt}/{StartMaxAttempts}"))
                    return;
            }

            DebugLog("[ZMQ] Start error: unable to bind default or dynamic loopback ports");
        }

        private static T BindSocket<T>(T socket, string endpoint) where T : NetMQSocket
        {
            socket.Options.Linger = TimeSpan.Zero;
            socket.Bind(endpoint);
            return socket;
        }

        private bool TryStart(EndpointSet endpoints, string label)
        {
            PublisherSocket pub = null;
            PullSocket pull = null;
            ResponseSocket rep = null;

            try
            {
                pub = BindSocket(new PublisherSocket(), endpoints.PubEndpoint);
                pull = BindSocket(new PullSocket(), endpoints.PullEndpoint);
                rep = BindSocket(new ResponseSocket(), endpoints.RepEndpoint);

                _pubSocket = pub;
                _pullSocket = pull;
                _repSocket = rep;
                _pubEndpoint = endpoints.PubEndpoint;
                _pullEndpoint = endpoints.PullEndpoint;
                _repEndpoint = endpoints.RepEndpoint;

                Profile = new ConnectionProfile
                {
                    InstanceId = _instanceId,
                    PubEndpoint = endpoints.PubEndpoint,
                    PushEndpoint = endpoints.PullEndpoint,
                    ReqEndpoint = endpoints.RepEndpoint,
                    Token = _connectionToken,
                    StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };
                ConnectionProfileStore.Write(Profile);

                var token = _cts.Token;
                _commandTask = Task.Run(() => CommandLoop(token));
                _repTask = Task.Run(() => RepLoop(token));
                IsRunning = true;
                DebugLog($"[ZMQ] Started ({label}) PUB={endpoints.PubEndpoint}, PULL={endpoints.PullEndpoint}, REP={endpoints.RepEndpoint}");
                return true;
            }
            catch (Exception ex)
            {
                IsRunning = false;
                ReleaseSocket(pub, endpoints.PubEndpoint);
                ReleaseSocket(pull, endpoints.PullEndpoint);
                ReleaseSocket(rep, endpoints.RepEndpoint);
                _pubSocket = null;
                _pullSocket = null;
                _repSocket = null;

                var suffix = IsAddressInUse(ex) ? "address in use" : ex.Message;
                DebugLog($"[ZMQ] Could not start on {label} ({endpoints.Summary}): {suffix}");
                return false;
            }
        }

        private static EndpointSet DefaultEndpoints()
        {
            return new EndpointSet(DefaultPubPort, DefaultPullPort, DefaultRepPort);
        }

        private static EndpointSet RandomEndpoints()
        {
            var ports = new HashSet<int>();
            return new EndpointSet(
                ReserveLoopbackPort(ports),
                ReserveLoopbackPort(ports),
                ReserveLoopbackPort(ports));
        }

        private static int ReserveLoopbackPort(HashSet<int> used)
        {
            while (true)
            {
                var listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                try
                {
                    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                    if (used.Add(port))
                        return port;
                }
                finally
                {
                    listener.Stop();
                }
            }
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

                if (!IsAuthorized(request.Token))
                {
                    DebugLog("[PULL] Rejected submitJob: invalid connection token");
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

                if (type == "ping")
                {
                    if (!IsAuthorized(doc.RootElement))
                    {
                        return JsonSerializer.Serialize(new AuthErrorResponse
                        {
                            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                            Error = "Invalid connection token"
                        });
                    }

                    return JsonSerializer.Serialize(new PingResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    });
                }

                if (!IsAuthorized(doc.RootElement))
                {
                    return JsonSerializer.Serialize(new AuthErrorResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Error = "Invalid connection token"
                    });
                }

                if (_requestDispatcher.TryDispatch(type, _doc, doc.RootElement, out var response))
                {
                    if (_cts.IsCancellationRequested)
                        return JsonSerializer.Serialize(new { error = "Service shutting down" });

                    return response;
                }

                return JsonSerializer.Serialize(new { error = $"Unknown request type: {type}" });
            }
            catch (Exception ex)
            {
                DebugLog($"[REP] HandleRequest error: {ex.Message}");
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
        }

        private bool IsAuthorized(JsonElement root)
        {
            return root.TryGetProperty("token", out var tokenElement) &&
                tokenElement.ValueKind == JsonValueKind.String &&
                IsAuthorized(tokenElement.GetString());
        }

        private bool IsAuthorized(string token)
        {
            if (string.IsNullOrEmpty(_connectionToken) || string.IsNullOrEmpty(token))
                return false;

            var expected = Encoding.UTF8.GetBytes(_connectionToken);
            var actual = Encoding.UTF8.GetBytes(token);
            if (expected.Length != actual.Length)
                return false;

            return CryptographicOperations.FixedTimeEquals(expected, actual);
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

            ReleaseSocket(_pubSocket, _pubEndpoint);
            ReleaseSocket(_pullSocket, _pullEndpoint);
            ReleaseSocket(_repSocket, _repEndpoint);
            ConnectionProfileStore.DeleteIfOwned(_instanceId);
            _pubSocket = null;
            _pullSocket = null;
            _repSocket = null;

            var commandTask = _commandTask;
            var repTask = _repTask;
            var cts = _cts;
            _commandTask = null;
            _repTask = null;
            _cts = null;
            Profile = null;

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
            if (socket == null || string.IsNullOrEmpty(endpoint))
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

        private class EndpointSet
        {
            public EndpointSet(int pubPort, int pullPort, int repPort)
            {
                PubEndpoint = FormatEndpoint(pubPort);
                PullEndpoint = FormatEndpoint(pullPort);
                RepEndpoint = FormatEndpoint(repPort);
                Summary = $"{pubPort}/{pullPort}/{repPort}";
            }

            public string PubEndpoint { get; }
            public string PullEndpoint { get; }
            public string RepEndpoint { get; }
            public string Summary { get; }

            private static string FormatEndpoint(int port)
            {
                return $"tcp://{ZMqService.LoopbackHost}:{port}";
            }
        }
    }
}
