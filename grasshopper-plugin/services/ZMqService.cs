using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
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
using Rhino;
using rhino_zmq_poc.Protocol;
using rhino_zmq_poc.Protocol.Execution;
using Execution = rhino_zmq_poc.Protocol.Execution;

namespace rhino_zmq_poc
{
    internal class ZMqService : IDisposable
    {
        private const string LoopbackHost = "127.0.0.1";
        private const int DefaultPubPort = 5555;
        private const int DefaultPullPort = 5556;
        private const int DefaultRepPort = 5557;
        private const int StartMaxAttempts = 5;
        private const int LedgerCapacity = 1024;
        private static readonly TimeSpan UiDispatchTimeout = TimeSpan.FromSeconds(120);
        private static readonly TimeSpan GateTimeout = TimeSpan.FromSeconds(30);

        /// <summary>
        /// Legacy PULL/PUSH command actions that must not run through the
        /// versioned executeActions route: reads belong to the query protocol
        /// and transaction control belongs to the TransactionCoordinator.
        /// </summary>
        private static readonly HashSet<string> LegacyControlActions = new HashSet<string>(
            new[]
            {
                "getScriptCode",
                "listScriptParams",
                "beginAgentTransaction",
                "commitAgentTransaction",
                "cancelAgentTransaction",
                "beginRhinoAgentTransaction",
                "commitRhinoAgentTransaction",
                "cancelRhinoAgentTransaction",
            },
            StringComparer.Ordinal);

        private PublisherSocket _pubSocket;
        private PullSocket _pullSocket;

        /// <summary>
        /// The request/reply endpoint now uses a RouterSocket so a long-running
        /// mutation cannot prevent getRequestStatus from being received. The
        /// socket thread owns the router; workers only enqueue outbound replies.
        /// The profile field keeps its historical ReqEndpoint name.
        /// </summary>
        private RouterSocket _repSocket;
        private CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _commandTask;
        private Task _repTask;
        private int _stopped;
        private readonly JobQueue _jobQueue;
        private readonly GH_Document _doc;
        private readonly UiRequestDispatcher _requestDispatcher = new UiRequestDispatcher();
        private readonly object _dispatchLock = new object();
        private readonly ConcurrentQueue<(string topic, string json)> _publishQueue = new ConcurrentQueue<(string, string)>();
        private readonly ConcurrentQueue<(byte[] identity, string payload)> _replyQueue = new ConcurrentQueue<(byte[], string)>();
        private readonly Action<GhJobStatus> _jobStatusHandler;
        private readonly DocumentIdentityService _identityService;
        private readonly RequestLedger _requestLedger;
        private readonly BackendRequestRouter _backendRouter;
        private readonly TransactionCoordinator _coordinator;
        private readonly CanvasCheckpointService _checkpoints;
        private readonly IDocumentExecutionGate _executionGate;
        private readonly IUiThreadDispatcher _uiDispatcher;
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
            _requestDispatcher.Register("applyGraph", new ApplyGraphHandler());
            _requestDispatcher.Register("listScriptParams", new ListScriptParamsHandler());
            _requestDispatcher.Register("getScriptCode", new GetScriptCodeHandler());
            _requestDispatcher.Register("runRhinoScript", new RunRhinoScriptHandler());
            _requestDispatcher.Register("queryRhinoObjects", new QueryRhinoObjectsHandler());
            _requestDispatcher.Register("captureRhinoView", new CaptureRhinoViewHandler());
            _requestDispatcher.Register("controlRhinoView", new ControlRhinoViewHandler());
            _requestDispatcher.Register("getParamRhinoGeometry", new GetParamRhinoGeometryHandler());
            _identityService = new DocumentIdentityService(PluginVersion);
            _requestLedger = new RequestLedger(LedgerCapacity);
            _executionGate = new DocumentExecutionGate();
            _uiDispatcher = new RhinoUiThreadDispatcher(UiDispatchTimeout);
            _checkpoints = new CanvasCheckpointService(64 * 1024 * 1024);
            _coordinator = BuildTransactionCoordinator();
            _backendRouter = BuildBackendRouter();
            _jobStatusHandler = status =>
            {
                OnJobStatus?.Invoke(status);
                EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            };
            _jobQueue.OnStatusChanged += _jobStatusHandler;
        }

        private static string PluginVersion =>
            typeof(ZMqService).Assembly.GetName().Version?.ToString() ?? "unknown";

        private BackendDocumentsDto CurrentDocuments() => _identityService.GetDocuments(_doc, RhinoDoc.ActiveDoc);

        private TransactionCoordinator BuildTransactionCoordinator()
        {
            var commands = new CommandHandlerRegistry();
            var executor = new CommandExecutor(DebugLog);
            foreach (var action in CommandActionRegistry.KnownActions)
            {
                if (LegacyControlActions.Contains(action)) continue;
                commands.Register(new LegacyCommandHandlerAdapter(action, executor));
            }

            return new TransactionCoordinator(
                new CommandBackendActionExecutor(commands, ExecuteNonCommandAction),
                _uiDispatcher,
                _executionGate,
                new ExpectedIdentityValidator(
                    () => _identityService.Backend,
                    (grasshopperDocument, rhinoDocument) =>
                        _identityService.GetDocuments(grasshopperDocument, rhinoDocument)),
                new LegacyAgentTransactionFactory(),
                GateTimeout);
        }

        private BackendRequestRouter BuildBackendRouter()
        {
            var router = new BackendRequestRouter(
                IsAuthorized,
                () => _identityService.Backend,
                CurrentDocuments,
                maxRequestBytes: 64 * 1024 * 1024);
            router.Register("getBackendInfo", new GetBackendInfoHandler(
                new[]
                {
                    "executeActions",
                    "getBackendInfo",
                    "getRequestStatus",
                    "query",
                    "captureCheckpoint",
                    "restoreCheckpoint",
                },
                64 * 1024 * 1024,
                maxCheckpointBytes: 64 * 1024 * 1024,
                deduplicationWindowMs: (long)RequestLedger.DefaultWindow.TotalMilliseconds));
            router.Register("query", new QueryHandler(_requestDispatcher, _dispatchLock, () => _doc));
            router.Register("executeActions", new ExecuteActionsHandler(
                _requestLedger,
                _coordinator,
                () => _doc,
                () => RhinoDoc.ActiveDoc));
            router.Register("getRequestStatus", new GetRequestStatusHandler(_requestLedger));
            router.Register("captureCheckpoint", new CaptureCheckpointHandler(
                _checkpoints,
                _uiDispatcher,
                _executionGate,
                GateTimeout,
                () => _doc,
                () => _identityService.Backend,
                CurrentDocuments));
            router.Register("restoreCheckpoint", new RestoreCheckpointHandler(
                _requestLedger,
                _checkpoints,
                _uiDispatcher,
                _executionGate,
                GateTimeout,
                () => _doc,
                () => _identityService.Backend,
                CurrentDocuments));
            return router;
        }

        /// <summary>
        /// Executes the non-command backend action kinds on the UI thread (the
        /// coordinator already marshals this call).
        /// </summary>
        private Execution.ActionResult ExecuteNonCommandAction(
            GH_Document ghDocument,
            RhinoDoc rhinoDocument,
            BackendAction action)
        {
            try
            {
                switch (action?.Kind)
                {
                    case "applyGraph":
                    {
                        var request = action.Input.ValueKind == JsonValueKind.Object
                            ? JsonSerializer.Deserialize<ApplyGraphRequest>(action.Input.GetRawText())
                            : null;
                        if (request == null)
                            return Execution.ActionResult.Failure("invalid_input", "An applyGraph input object is required.");
                        var applied = GraphOperations.Apply(ghDocument, request);
                        return new Execution.ActionResult
                        {
                            Outcome = applied.Ok
                                ? Execution.ExecutionOutcomes.Succeeded
                                : Execution.ExecutionOutcomes.Failed,
                            Message = applied.Ok
                                ? $"applyGraph committed ({applied.Counts?.Components ?? 0} components)"
                                : "applyGraph failed structurally and was rolled back.",
                            Data = applied,
                            Error = applied.Ok
                                ? null
                                : new Execution.HopperError
                                {
                                    Code = "operation_failed",
                                    Message = string.Join("; ", applied.StructuralErrors?.Select(error => $"{error.Path}: {error.Code}") ?? Array.Empty<string>()),
                                    Retryable = false,
                                },
                        };
                    }
                    case "runRhinoScript":
                    {
                        var mode = action.Input.TryGetProperty("mode", out var modeElement) ? modeElement.GetString() : null;
                        var source = action.Input.TryGetProperty("source", out var sourceElement) ? sourceElement.GetString() : null;
                        var echo = action.Input.TryGetProperty("echo", out var echoElement) && echoElement.ValueKind == JsonValueKind.True;
                        var result = RhinoScriptExecutor.Run(rhinoDocument, new RunRhinoScriptParams
                        {
                            Mode = mode,
                            Source = source,
                            Echo = echo,
                        });
                        return new Execution.ActionResult
                        {
                            Outcome = result.Ok
                                ? Execution.ExecutionOutcomes.Succeeded
                                : Execution.ExecutionOutcomes.Failed,
                            Message = result.Ok ? "Script completed." : (result.Error ?? "Script failed."),
                            Data = result,
                            Error = result.Ok
                                ? null
                                : new Execution.HopperError
                                {
                                    Code = "operation_failed",
                                    Message = result.Error ?? "Script failed.",
                                    Retryable = false,
                                },
                        };
                    }
                    case "controlRhinoView":
                    {
						var param = action.Input.ValueKind == JsonValueKind.Object
							? JsonSerializer.Deserialize<ControlRhinoViewParams>(action.Input.GetRawText())
							: null;
						var controlled = ViewportCaptureOps.Control(rhinoDocument, param);
						return controlled.Ok
							? Execution.ActionResult.Success(controlled.Message ?? "View control applied.", controlled)
							: new Execution.ActionResult
							{
								Outcome = Execution.ExecutionOutcomes.Failed,
								Message = controlled.Error ?? "View control failed.",
								Data = controlled,
								Error = new Execution.HopperError
								{
									Code = "operation_failed",
									Message = controlled.Error ?? "View control failed.",
									Retryable = false,
								},
							};
                    }
                    default:
                        return Execution.ActionResult.Failure(
                            "invalid_command",
                            $"No handler is registered for action kind '{action?.Kind}'.");
                }
            }
            catch (Exception ex)
            {
                return Execution.ActionResult.Failure("operation_failed", $"{ex.GetType().Name}: {ex.Message}");
            }
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
            RouterSocket rep = null;

            try
            {
                pub = BindSocket(new PublisherSocket(), endpoints.PubEndpoint);
                pull = BindSocket(new PullSocket(), endpoints.PullEndpoint);
                rep = BindSocket(new RouterSocket(), endpoints.RepEndpoint);

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
                _repTask = Task.Run(() => RouterLoop(token));
                IsRunning = true;
                DebugLog($"[ZMQ] Started ({label}) PUB={endpoints.PubEndpoint}, PULL={endpoints.PullEndpoint}, ROUTER={endpoints.RepEndpoint}");
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

                    DebugLog($"[PULL] Received: {RequestLogRedactor.Redact(message)}");
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

        private void RouterLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    DrainReplyQueue();

                    if (_repSocket == null)
                        break;

                    var message = new NetMQMessage();
                    if (!_repSocket.TryReceiveMultipartMessage(TimeSpan.FromMilliseconds(100), ref message))
                        continue;

                    if (message.FrameCount < 3)
                        continue;

                    var identity = message[0].Buffer;
                    var payload = message[message.FrameCount - 1].ConvertToString();

                    DebugLog($"[ROUTER] Received: {RequestLogRedactor.Redact(payload)}");

                    if (ct.IsCancellationRequested)
                        break;

                    Task.Run(async () =>
                    {
                        try
                        {
                            var response = await HandleRoutedRequest(payload, ct);
                            _replyQueue.Enqueue((identity, response));
                        }
                        catch (OperationCanceledException)
                        {
                        }
                        catch (Exception ex)
                        {
                            DebugLog($"[ROUTER] Worker error: {ex.Message}");
                        }
                    }, ct);
                }
                catch (ObjectDisposedException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[ROUTER] Error: {ex.Message}");
                }
            }
        }

        private async Task<string> HandleRoutedRequest(string message, CancellationToken ct)
        {
            if (IsVersionedRequest(message))
            {
                var wire = await _backendRouter.DispatchAsync(message, ct).ConfigureAwait(false);
                return JsonSerializer.Serialize(wire);
            }
            return HandleRequest(message);
        }

        internal static bool IsVersionedRequest(string message)
        {
            try
            {
                using var document = JsonDocument.Parse(message);
                var root = document.RootElement;
                return root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("protocolVersion", out var version) &&
                    version.ValueKind == JsonValueKind.Number;
            }
            catch (JsonException)
            {
                return false;
            }
        }

        private void DrainReplyQueue()
        {
            while (_replyQueue.TryDequeue(out var reply))
            {
                try
                {
                    if (_repSocket == null)
                        return;

                    _repSocket
                        .SendMoreFrame(reply.identity)
                        .SendMoreFrame(Array.Empty<byte>())
                        .SendFrame(reply.payload);
                    DebugLog("[ROUTER] Sent response");
                }
                catch (Exception ex)
                {
                    DebugLog($"[ROUTER] Send error: {ex.Message}");
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
                var type = doc.RootElement.TryGetProperty("type", out var typeElement)
                    ? typeElement.GetString()
                    : null;

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

                string response;
                lock (_dispatchLock)
                {
                    if (!_requestDispatcher.TryDispatch(type, _doc, doc.RootElement, out response))
                        return JsonSerializer.Serialize(new { error = $"Unknown request type: {type}" });
                }

                if (_cts.IsCancellationRequested)
                    return JsonSerializer.Serialize(new { error = "Service shutting down" });

                return response;
            }
            catch (HopperRequestException ex)
            {
                // Legacy clients still expect { error } bodies for handler failures.
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                DebugLog($"[ROUTER] HandleRequest error: {ex.Message}");
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

            DrainBackgroundTasks(commandTask, repTask, cts);
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
