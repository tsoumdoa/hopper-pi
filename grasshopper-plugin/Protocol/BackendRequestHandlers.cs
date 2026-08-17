using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using rhino_zmq_poc.Protocol.Execution;

namespace rhino_zmq_poc.Protocol
{
    internal sealed class GetBackendInfoHandler : IBackendRequestHandler
    {
        private readonly string[] _capabilities;
        private readonly int _maxRequestBytes;
        private readonly int _maxCheckpointBytes;
        private readonly long _deduplicationWindowMs;

        public GetBackendInfoHandler(
            IEnumerable<string> capabilities,
            int maxRequestBytes,
            int maxCheckpointBytes,
            long deduplicationWindowMs)
        {
            _capabilities = capabilities?.OrderBy(value => value, StringComparer.Ordinal).ToArray()
                ?? Array.Empty<string>();
            _maxRequestBytes = maxRequestBytes;
            _maxCheckpointBytes = maxCheckpointBytes;
            _deduplicationWindowMs = deduplicationWindowMs;
        }

        public Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            return Task.FromResult(BackendRequestRouter.Success("succeeded", new BackendInfoDataDto
            {
                Capabilities = new List<string>(_capabilities),
                MaxRequestBytes = _maxRequestBytes,
                MaxCheckpointBytes = _maxCheckpointBytes,
                DeduplicationWindowMs = _deduplicationWindowMs,
            }));
        }
    }

    /// <summary>
    /// Runs one BackendQuery through the legacy UI-thread request handlers and
    /// wraps the domain response in the versioned envelope. Handlers report
    /// semantic failures by throwing <see cref="HopperRequestException"/>.
    /// </summary>
    internal sealed class QueryHandler : IBackendRequestHandler
    {
        private readonly UiRequestDispatcher _dispatcher;
        private readonly object _dispatchLock;
        private readonly Func<GH_Document> _grasshopperDocument;

        public QueryHandler(
            UiRequestDispatcher dispatcher,
            object dispatchLock,
            Func<GH_Document> grasshopperDocument)
        {
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _dispatchLock = dispatchLock ?? new object();
            _grasshopperDocument = grasshopperDocument ?? (() => null);
        }

        public Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            if (!body.TryGetProperty("query", out var query) || query.ValueKind != JsonValueKind.Object)
                throw new HopperRequestException("invalid_input", "A query object is required.");
            if (!query.TryGetProperty("kind", out var kindElement) || kindElement.ValueKind != JsonValueKind.String)
                throw new HopperRequestException("invalid_input", "A query kind is required.");
            var kind = kindElement.GetString();
            var input = query.TryGetProperty("input", out var inputElement) && inputElement.ValueKind == JsonValueKind.Object
                ? inputElement.Clone()
                : JsonSerializer.SerializeToElement(new object());

            if (body.TryGetProperty("expectedBackendId", out var backendId) &&
                backendId.ValueKind == JsonValueKind.String &&
                !string.Equals(backendId.GetString(), context.Backend?.BackendId, StringComparison.Ordinal))
            {
                throw new HopperRequestException(
                    "backend_conflict",
                    "The backend identity does not match the expected backend.");
            }

            var documents = context.DocumentsProvider?.Invoke();
            if (documents == null)
                throw new HopperRequestException("document_conflict", "No Grasshopper document is active.");
            if (body.TryGetProperty("expectedGrasshopperDocumentId", out var ghId) &&
                ghId.ValueKind == JsonValueKind.String &&
                !string.Equals(ghId.GetString(), documents.Grasshopper?.DocumentId, StringComparison.Ordinal))
            {
                throw new HopperRequestException(
                    "document_conflict",
                    "The active Grasshopper document does not match the expected document.");
            }
            var hasExpectedRhino = body.TryGetProperty("expectedRhinoDocumentId", out var rhinoId);
            if (hasExpectedRhino)
            {
                var expected = rhinoId.ValueKind == JsonValueKind.String ? rhinoId.GetString() : null;
                var actual = documents.Rhino?.DocumentId;
                if (expected != actual)
                    throw new HopperRequestException(
                        "document_conflict",
                        "The active Rhino document does not match the expected document.");
            }

            string responseJson;
            lock (_dispatchLock)
            {
                var doc = _grasshopperDocument();
                if (!_dispatcher.TryDispatch(kind, doc, input, out responseJson))
                    throw new HopperRequestException("invalid_command", $"Unknown query kind '{kind}'.");
            }

            var data = JsonSerializer.Deserialize<JsonElement>(responseJson);
            if (data.ValueKind == JsonValueKind.Object &&
                data.TryGetProperty("error", out var errorElement) &&
                errorElement.ValueKind == JsonValueKind.String)
            {
                // Bridge for handlers that have not migrated to
                // HopperRequestException yet. The error is a structured field,
                // not text sniffing; migrate the handler when you touch it.
                throw new HopperRequestException("operation_failed", errorElement.GetString());
            }

            return Task.FromResult(BackendRequestRouter.Success("succeeded", data));
        }
    }

    /// <summary>
    /// Verifies executeActions expected identities against the live documents
    /// before any mutation is scheduled.
    /// </summary>
    internal sealed class ExpectedIdentityValidator : IExecutionValidationHook
    {
        private readonly Func<BackendIdentityDto> _backend;
        private readonly Func<BackendDocumentsDto> _documents;

        public ExpectedIdentityValidator(
            Func<BackendIdentityDto> backend,
            Func<BackendDocumentsDto> documents)
        {
            _backend = backend ?? throw new ArgumentNullException(nameof(backend));
            _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        }

        public HopperError Validate(
            ExecuteActionsRequest request,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument)
        {
            if (string.IsNullOrEmpty(request.ExpectedBackendId))
                return Error("invalid_input", "expectedBackendId is required for mutations.");
            var backend = _backend();
            if (!string.Equals(request.ExpectedBackendId, backend?.BackendId, StringComparison.Ordinal))
                return Error("backend_conflict", "The backend identity does not match the expected backend.");

            var documents = _documents();
            if (ghDocument == null || documents?.Grasshopper == null ||
                !string.Equals(request.ExpectedGrasshopperDocumentId, documents.Grasshopper.DocumentId, StringComparison.Ordinal))
            {
                return Error("document_conflict", "The active Grasshopper document does not match the expected document.");
            }

            var actualRhino = documents.Rhino?.DocumentId;
            if (request.ExpectedRhinoDocumentId != actualRhino)
                return Error("document_conflict", "The active Rhino document does not match the expected document.");

            if (rhinoDocument == null &&
                (request.Scope == MutationScopes.Rhino ||
                 request.Scope == MutationScopes.Mixed ||
                 request.Scope == MutationScopes.Viewport))
            {
                return Error("document_conflict", "No Rhino document is active, but the mutation scope requires one.");
            }

            return null;
        }

        private static HopperError Error(string code, string message) => new HopperError
        {
            Code = code,
            Message = message,
            Retryable = false,
        };
    }

    internal sealed class ExecuteActionsHandler : IBackendRequestHandler
    {
        private readonly RequestLedger _ledger;
        private readonly TransactionCoordinator _coordinator;
        private readonly Func<GH_Document> _grasshopperDocument;
        private readonly Func<RhinoDoc> _rhinoDocument;

        public ExecuteActionsHandler(
            RequestLedger ledger,
            TransactionCoordinator coordinator,
            Func<GH_Document> grasshopperDocument,
            Func<RhinoDoc> rhinoDocument)
        {
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
            _coordinator = coordinator ?? throw new ArgumentNullException(nameof(coordinator));
            _grasshopperDocument = grasshopperDocument ?? (() => null);
            _rhinoDocument = rhinoDocument ?? (() => null);
        }

        public async Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            // The envelope-level digest covers the canonical request body.
            ValidatePayloadSha256(context.PayloadSha256, body);
            var payloadSha256 = context.PayloadSha256;

            var begin = _ledger.TryBegin(context.RequestId, payloadSha256);
            switch (begin.Decision)
            {
                case LedgerDecision.Conflict:
                    throw new HopperRequestException(
                        "request_id_conflict",
                        "This request ID was already used with a different payload.");
                case LedgerDecision.Expired:
                    throw new HopperRequestException(
                        "request_expired",
                        "The request ID is older than the deduplication window.");
                case LedgerDecision.Busy:
                    throw new HopperRequestException(
                        "backend_busy",
                        "The request ledger is at capacity; retry later.",
                        retryable: true);
                case LedgerDecision.Existing:
                    return ExistingResponse(context, begin.Entry);
            }

            var request = ReadExecuteActionsRequest(context.RequestId, payloadSha256, body);
            var startedAt = DateTimeOffset.UtcNow;
            var execution = await _coordinator
                .ExecuteAsync(request, _grasshopperDocument(), _rhinoDocument(), context.ServiceStopping)
                .ConfigureAwait(false);
            var completedAt = DateTimeOffset.UtcNow;

            var cached = ToCachedResponse(execution);
            if (!_ledger.Complete(context.RequestId, payloadSha256, execution.Outcome, cached))
            {
                return BackendRequestRouter.Error(
                    context.RequestId,
                    "internal_error",
                    "The request ledger entry disappeared during execution.",
                    retryable: false);
            }

            return BuildExecutionResponse(context, execution, startedAt, completedAt);
        }

        private static WireResponseDto<JsonElement> ExistingResponse(RequestContext context, RequestLedgerEntry entry)
        {
            if (entry.CachedResponse != null)
            {
                entry.CachedResponse.Type = "executeActions";
                entry.CachedResponse.RequestId = context.RequestId;
                return entry.CachedResponse;
            }
            return BackendRequestRouter.Success("in_progress", new RequestStatusDataDto
            {
                TargetRequestId = context.RequestId,
                State = "running",
            });
        }

        private static WireResponseDto<JsonElement> BuildExecutionResponse(
            RequestContext context,
            ExecuteActionsResponse execution,
            DateTimeOffset startedAt,
            DateTimeOffset completedAt)
        {
            return new WireResponseDto<JsonElement>
            {
                Outcome = execution.Outcome,
                StartedAt = startedAt.UtcDateTime.ToString("O"),
                CompletedAt = completedAt.UtcDateTime.ToString("O"),
                Data = execution.Data == null
                    ? BackendRequestRouter.NullElement()
                    : JsonSerializer.SerializeToElement(execution.Data),
                Error = ToErrorDto(execution.Error),
            };
        }

        internal static void ValidatePayloadSha256(string payloadSha256, JsonElement body)
        {
            if (string.IsNullOrWhiteSpace(payloadSha256))
                throw new HopperRequestException("invalid_input", "A payloadSha256 is required for executeActions.");
            var computedDigest = CanonicalJson.Sha256(body);
            if (!string.Equals(payloadSha256, computedDigest, StringComparison.Ordinal))
                throw new HopperRequestException("invalid_input", "payloadSha256 does not match the canonical request body.");
        }

        internal static WireResponseDto<JsonElement> ToCachedResponse(ExecuteActionsResponse execution)
        {
            // Cached ledger responses replay the exact terminal outcome and data.
            return new WireResponseDto<JsonElement>
            {
                Outcome = execution.Outcome,
                Data = execution.Data == null
                    ? BackendRequestRouter.NullElement()
                    : JsonSerializer.SerializeToElement(execution.Data),
                Error = ToErrorDto(execution.Error),
            };
        }

        internal static ExecuteActionsRequest ReadExecuteActionsRequest(
            string requestId,
            string payloadSha256,
            JsonElement body)
        {
            var request = new ExecuteActionsRequest
            {
                RequestId = requestId,
                PayloadSha256 = payloadSha256,
            };
            foreach (var property in body.EnumerateObject())
            {
                switch (property.Name)
                {
                    case "expectedBackendId":
                        request.ExpectedBackendId = StringOrNull(property.Value);
                        break;
                    case "expectedGrasshopperDocumentId":
                        request.ExpectedGrasshopperDocumentId = StringOrNull(property.Value);
                        break;
                    case "expectedRhinoDocumentId":
                        request.ExpectedRhinoDocumentId = StringOrNull(property.Value);
                        break;
                    case "expectedCanvasDigest":
                        request.ExpectedCanvasDigest = StringOrNull(property.Value);
                        break;
                    case "transactionName":
                        request.TransactionName = StringOrNull(property.Value);
                        break;
                    case "scope":
                        request.Scope = StringOrNull(property.Value);
                        break;
                    case "actions":
                        request.Actions = JsonSerializer.Deserialize<List<BackendAction>>(property.Value.GetRawText())
                            ?? new List<BackendAction>();
                        break;
                }
            }
            return request;
        }

        private static HopperErrorDto ToErrorDto(HopperError error) => error == null
            ? null
            : new HopperErrorDto
            {
                Code = error.Code,
                Message = error.Message,
                Retryable = error.Retryable,
            };

        private static string StringOrNull(JsonElement value) =>
            value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    internal sealed class GetRequestStatusHandler : IBackendRequestHandler
    {
        private readonly RequestLedger _ledger;

        public GetRequestStatusHandler(RequestLedger ledger)
        {
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        }

        public Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            var targetRequestId = body.TryGetProperty("targetRequestId", out var target) &&
                target.ValueKind == JsonValueKind.String
                ? target.GetString()
                : null;
            var payloadSha256 = body.TryGetProperty("payloadSha256", out var digest) &&
                digest.ValueKind == JsonValueKind.String
                ? digest.GetString()
                : null;
            if (string.IsNullOrWhiteSpace(targetRequestId) || string.IsNullOrWhiteSpace(payloadSha256))
                throw new HopperRequestException("invalid_input", "targetRequestId and payloadSha256 are required.");

            var result = _ledger.GetStatus(targetRequestId, payloadSha256);
            switch (result.Decision)
            {
                case LedgerDecision.Conflict:
                    throw new HopperRequestException(
                        "request_id_conflict",
                        "The stored request used a different payload digest.");
				case LedgerDecision.Expired:
					return Task.FromResult(BackendRequestRouter.Success("succeeded", new RequestStatusDataDto
					{
						TargetRequestId = targetRequestId,
						State = "expired",
						CachedResponse = null,
					}));
				case LedgerDecision.NotFound:
					return Task.FromResult(BackendRequestRouter.Success("succeeded", new RequestStatusDataDto
					{
						TargetRequestId = targetRequestId,
						State = "not_found",
						CachedResponse = null,
					}));
                default:
                    return Task.FromResult(BackendRequestRouter.Success("succeeded", new RequestStatusDataDto
                    {
                        TargetRequestId = targetRequestId,
                        State = result.Entry.State,
                        CachedResponse = result.Entry.CachedResponse,
                    }));
            }
        }
    }

    internal sealed class CaptureCheckpointHandler : IBackendRequestHandler
    {
        private readonly CanvasCheckpointService _checkpoints;
        private readonly IUiThreadDispatcher _dispatcher;
        private readonly IDocumentExecutionGate _gate;
        private readonly TimeSpan _gateTimeout;
        private readonly Func<GH_Document> _grasshopperDocument;
        private readonly Func<BackendIdentityDto> _backend;
        private readonly Func<BackendDocumentsDto> _documents;

        public CaptureCheckpointHandler(
            CanvasCheckpointService checkpoints,
            IUiThreadDispatcher dispatcher,
            IDocumentExecutionGate gate,
            TimeSpan gateTimeout,
            Func<GH_Document> grasshopperDocument,
            Func<BackendIdentityDto> backend,
            Func<BackendDocumentsDto> documents)
        {
            _checkpoints = checkpoints ?? throw new ArgumentNullException(nameof(checkpoints));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _gate = gate ?? throw new ArgumentNullException(nameof(gate));
            _gateTimeout = gateTimeout;
            _grasshopperDocument = grasshopperDocument ?? (() => null);
            _backend = backend ?? throw new ArgumentNullException(nameof(backend));
            _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        }

        public async Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            var expectedBackendId = StringOrNull(body, "expectedBackendId");
            var expectedDocumentId = StringOrNull(body, "expectedGrasshopperDocumentId");
            var backend = _backend();
            var documents = _documents();
            if (string.IsNullOrEmpty(expectedBackendId) ||
                !string.Equals(expectedBackendId, backend?.BackendId, StringComparison.Ordinal))
            {
                throw new HopperRequestException("backend_conflict", "The backend identity does not match the expected backend.");
            }
            if (documents?.Grasshopper == null ||
                !string.Equals(expectedDocumentId, documents.Grasshopper.DocumentId, StringComparison.Ordinal))
            {
                throw new HopperRequestException(
                    "document_conflict",
                    "The active Grasshopper document does not match the expected document.");
            }

            IDisposable lease;
            try
            {
                lease = await _gate.AcquireMutationAsync(expectedDocumentId, _gateTimeout, context.ServiceStopping)
                    .ConfigureAwait(false);
            }
            catch (TimeoutException ex)
            {
                throw new HopperRequestException("backend_busy", ex.Message, retryable: true);
            }
            catch (OperationCanceledException ex)
            {
                throw new HopperRequestException("backend_busy", ex.Message, retryable: true);
            }

            using (lease)
            {
                var envelope = await _dispatcher.InvokeAsync(
                    () => _checkpoints.Capture(_grasshopperDocument(), backend, documents.Grasshopper),
                    context.ServiceStopping).ConfigureAwait(false);
                return BackendRequestRouter.Success("succeeded", envelope);
            }
        }

        private static string StringOrNull(JsonElement body, string name) =>
            body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }

    internal sealed class RestoreCheckpointHandler : IBackendRequestHandler
    {
        private readonly RequestLedger _ledger;
        private readonly CanvasCheckpointService _checkpoints;
        private readonly IUiThreadDispatcher _dispatcher;
        private readonly IDocumentExecutionGate _gate;
        private readonly TimeSpan _gateTimeout;
        private readonly Func<GH_Document> _grasshopperDocument;
        private readonly Func<BackendIdentityDto> _backend;
        private readonly Func<BackendDocumentsDto> _documents;

        public RestoreCheckpointHandler(
            RequestLedger ledger,
            CanvasCheckpointService checkpoints,
            IUiThreadDispatcher dispatcher,
            IDocumentExecutionGate gate,
            TimeSpan gateTimeout,
            Func<GH_Document> grasshopperDocument,
            Func<BackendIdentityDto> backend,
            Func<BackendDocumentsDto> documents)
        {
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
            _checkpoints = checkpoints ?? throw new ArgumentNullException(nameof(checkpoints));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _gate = gate ?? throw new ArgumentNullException(nameof(gate));
            _gateTimeout = gateTimeout;
            _grasshopperDocument = grasshopperDocument ?? (() => null);
            _backend = backend ?? throw new ArgumentNullException(nameof(backend));
            _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        }

        public async Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
        {
            ExecuteActionsHandler.ValidatePayloadSha256(context.PayloadSha256, body);
            var begin = _ledger.TryBegin(context.RequestId, context.PayloadSha256);
            switch (begin.Decision)
            {
                case LedgerDecision.Conflict:
                    throw new HopperRequestException(
                        "request_id_conflict",
                        "This request ID was already used with a different payload.");
                case LedgerDecision.Expired:
                    throw new HopperRequestException(
                        "request_expired",
                        "The request ID is older than the deduplication window.");
                case LedgerDecision.Busy:
                    throw new HopperRequestException(
                        "backend_busy",
                        "The request ledger is at capacity; retry later.",
                        retryable: true);
                case LedgerDecision.Existing:
                    if (begin.Entry.CachedResponse != null)
                    {
                        begin.Entry.CachedResponse.Type = "restoreCheckpoint";
                        begin.Entry.CachedResponse.RequestId = context.RequestId;
                        return begin.Entry.CachedResponse;
                    }
                    return BackendRequestRouter.Success("in_progress", new RequestStatusDataDto
                    {
                        TargetRequestId = context.RequestId,
                        State = "running",
                    });
            }

            try
            {
                var expectedBackendId = StringOrNull(body, "expectedBackendId");
                var expectedDocumentId = StringOrNull(body, "expectedGrasshopperDocumentId");
                var expectedLiveDigest = StringOrNull(body, "expectedLiveCanvasDigest");
                var transactionName = StringOrNull(body, "transactionName") ?? "Hopper restore";
                if (!body.TryGetProperty("checkpoint", out var checkpointElement) ||
                    checkpointElement.ValueKind != JsonValueKind.Object)
                {
                    throw new HopperRequestException("invalid_input", "A checkpoint object is required.");
                }

                var backend = _backend();
                var documents = _documents();
                if (!string.Equals(expectedBackendId, backend?.BackendId, StringComparison.Ordinal))
                    throw new HopperRequestException("backend_conflict", "The backend identity does not match the expected backend.");
                if (documents?.Grasshopper == null ||
                    !string.Equals(expectedDocumentId, documents.Grasshopper.DocumentId, StringComparison.Ordinal))
                {
                    throw new HopperRequestException(
                        "document_conflict",
                        "The active Grasshopper document does not match the expected document.");
                }

                var checkpoint = JsonSerializer.Deserialize<CanvasCheckpointEnvelopeDto>(checkpointElement.GetRawText())
                    ?? throw new HopperRequestException("invalid_input", "The checkpoint envelope is invalid.");
                if (!string.Equals(checkpoint.BackendId, expectedBackendId, StringComparison.Ordinal) ||
                    !string.Equals(checkpoint.GrasshopperDocumentId, expectedDocumentId, StringComparison.Ordinal))
                {
                    throw new HopperRequestException(
                        "document_conflict",
                        "The checkpoint was captured against a different backend or document.");
                }

                IDisposable lease;
                try
                {
                    lease = await _gate.AcquireMutationAsync(expectedDocumentId, _gateTimeout, context.ServiceStopping)
                        .ConfigureAwait(false);
                }
                catch (TimeoutException ex)
                {
                    throw new HopperRequestException("backend_busy", ex.Message, retryable: true);
                }
                catch (OperationCanceledException ex)
                {
                    throw new HopperRequestException("backend_busy", ex.Message, retryable: true);
                }

                RestoreCheckpointDataDto restored;
                using (lease)
                {
                    restored = await _dispatcher.InvokeAsync(
                        () => _checkpoints.CompareAndRestore(
                            _grasshopperDocument(),
                            checkpoint,
                            expectedLiveDigest,
                            transactionName),
                        context.ServiceStopping).ConfigureAwait(false);
                }

                var response = BackendRequestRouter.Success("succeeded", restored);
                _ledger.Complete(context.RequestId, context.PayloadSha256, "succeeded", response);
                return response;
            }
            catch (HopperRequestException ex)
            {
                var failed = BackendRequestRouter.Error(
                    context.RequestId,
                    ex.Code,
                    ex.Message,
                    ex.Retryable,
                    type: "restoreCheckpoint");
                _ledger.Complete(context.RequestId, context.PayloadSha256, "failed", failed);
                throw;
            }
        }

        private static string StringOrNull(JsonElement body, string name) =>
            body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }
}
