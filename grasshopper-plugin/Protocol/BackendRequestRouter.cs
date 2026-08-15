using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace rhino_zmq_poc.Protocol
{
    /// <summary>
    /// Thrown by request handlers to surface a structured error instead of a
    /// prose string. The router converts it into a WireResponse error.
    /// </summary>
    internal sealed class HopperRequestException : Exception
    {
        public HopperRequestException(string code, string message, bool retryable = false)
            : base(message)
        {
            Code = code;
            Retryable = retryable;
        }

        public string Code { get; }
        public bool Retryable { get; }
    }

    internal sealed class RequestContext
    {
        public string RequestId { get; init; }
        public string IssuedAt { get; init; }
        public string PayloadSha256 { get; init; }
        public BackendIdentityDto Backend { get; init; }
        public Func<BackendDocumentsDto> DocumentsProvider { get; init; }
        public CancellationToken ServiceStopping { get; init; }
    }

    internal interface IBackendRequestHandler
    {
        Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body);
    }

    internal sealed class BackendRequestRouter
    {
        public const int DefaultMaxRequestBytes = 32 * 1024 * 1024;

        private readonly object _sync = new object();
        private readonly Dictionary<string, IBackendRequestHandler> _handlers =
            new Dictionary<string, IBackendRequestHandler>(StringComparer.Ordinal);
        private readonly Func<string, bool> _authorize;
        private readonly Func<BackendIdentityDto> _backendProvider;
        private readonly Func<BackendDocumentsDto> _documentsProvider;
        private readonly int _maxRequestBytes;

        public BackendRequestRouter(
            Func<string, bool> authorize,
            Func<BackendIdentityDto> backendProvider,
            Func<BackendDocumentsDto> documentsProvider,
            int maxRequestBytes = DefaultMaxRequestBytes)
        {
            _authorize = authorize ?? (_ => true);
            _backendProvider = backendProvider ?? throw new ArgumentNullException(nameof(backendProvider));
            _documentsProvider = documentsProvider ?? throw new ArgumentNullException(nameof(documentsProvider));
            _maxRequestBytes = maxRequestBytes > 0 ? maxRequestBytes : DefaultMaxRequestBytes;
        }

        public void Register(string requestType, IBackendRequestHandler handler)
        {
            if (string.IsNullOrWhiteSpace(requestType))
                throw new ArgumentException("A request type is required.", nameof(requestType));
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            lock (_sync)
            {
                _handlers[requestType] = handler;
            }
        }

        public IReadOnlyCollection<string> KnownRequestTypes
        {
            get
            {
                lock (_sync) return new List<string>(_handlers.Keys).AsReadOnly();
            }
        }

        public async Task<WireResponseDto<JsonElement>> DispatchAsync(
            string json,
            CancellationToken stoppingToken)
        {
            if (string.IsNullOrEmpty(json) || EncodingByteLength(json) > _maxRequestBytes)
                return Error(null, "invalid_input", "Request is empty or exceeds the payload limit.", retryable: false);

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(json);
            }
            catch (JsonException ex)
            {
                return Error(null, "invalid_input", $"Request is not valid JSON: {ex.Message}", retryable: false);
            }

            using (document)
            {
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                    return Error(null, "invalid_input", "Request must be a JSON object.", retryable: false);

                string requestId = null;
                string issuedAt = null;
                string payloadSha256 = null;
                string type = null;
                int protocolVersion = 0;
                foreach (var property in root.EnumerateObject())
                {
                    switch (property.Name)
                    {
                        case "protocolVersion":
                            if (property.Value.ValueKind == JsonValueKind.Number)
                                protocolVersion = property.Value.GetInt32();
                            break;
                        case "type":
                            if (property.Value.ValueKind == JsonValueKind.String)
                                type = property.Value.GetString();
                            break;
                        case "requestId":
                            if (property.Value.ValueKind == JsonValueKind.String)
                                requestId = property.Value.GetString();
                            break;
                        case "issuedAt":
                            if (property.Value.ValueKind == JsonValueKind.String)
                                issuedAt = property.Value.GetString();
                            break;
                        case "payloadSha256":
                            if (property.Value.ValueKind == JsonValueKind.String)
                                payloadSha256 = property.Value.GetString();
                            break;
                    }
                }

                if (protocolVersion != HopperProtocol.Version)
                    return Error(
                        requestId,
                        "protocol_mismatch",
                        $"Protocol version {protocolVersion} is not supported; this backend speaks version {HopperProtocol.Version}.",
                        retryable: false,
                        type: type);

                if (string.IsNullOrWhiteSpace(type))
                    return Error(requestId, "invalid_input", "A request type is required.", retryable: false);

                string token = null;
                if (root.TryGetProperty("token", out var tokenElement) &&
                    tokenElement.ValueKind == JsonValueKind.String)
                {
                    token = tokenElement.GetString();
                }
                if (!_authorize(token))
                    return Error(requestId, "authentication_failed", "Invalid connection token.", retryable: false, type: type);

                if (string.IsNullOrWhiteSpace(requestId))
                    return Error(null, "invalid_input", "A requestId is required.", retryable: false, type: type);

                IBackendRequestHandler handler;
                lock (_sync)
                {
                    _handlers.TryGetValue(type, out handler);
                }
                if (handler == null)
                    return Error(requestId, "invalid_command", $"Unknown request type '{type}'.", retryable: false, type: type);

                if (!root.TryGetProperty("body", out var body) || body.ValueKind != JsonValueKind.Object)
                    return Error(requestId, "invalid_input", "A JSON object body is required.", retryable: false, type: type);

                var context = new RequestContext
                {
                    RequestId = requestId,
                    IssuedAt = issuedAt ?? string.Empty,
                    PayloadSha256 = payloadSha256,
                    Backend = _backendProvider(),
                    DocumentsProvider = _documentsProvider,
                    ServiceStopping = stoppingToken,
                };

                try
                {
                    var response = await handler.HandleAsync(context, body).ConfigureAwait(false);
                    return WithEnvelope(response, context, type);
                }
                catch (HopperRequestException ex)
                {
                    return Error(requestId, ex.Code, ex.Message, ex.Retryable, type: type);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    return Error(
                        requestId,
                        "operation_failed",
                        $"{ex.GetType().Name}: {ex.Message}",
                        retryable: false,
                        type: type);
                }
            }
        }

        private static WireResponseDto<JsonElement> WithEnvelope(
            WireResponseDto<JsonElement> response,
            RequestContext context,
            string type)
        {
            response.Type = type;
            response.RequestId = context.RequestId;
            response.Backend ??= context.Backend;
            response.Documents ??= SafeDocuments(context);
            return response;
        }

        private static BackendDocumentsDto SafeDocuments(RequestContext context)
        {
            try
            {
                return context.DocumentsProvider?.Invoke();
            }
            catch
            {
                return null;
            }
        }

        public static WireResponseDto<JsonElement> Success(
            string outcome,
            object data,
            string startedAt = null,
            string completedAt = null) => new WireResponseDto<JsonElement>
        {
            Outcome = outcome,
            StartedAt = startedAt,
            CompletedAt = completedAt,
            Data = data == null
                ? NullElement()
                : JsonSerializer.SerializeToElement(data),
            Error = null,
        };

        public static WireResponseDto<JsonElement> Error(
            string requestId,
            string code,
            string message,
            bool retryable,
            string type = null,
            BackendIdentityDto backend = null) => new WireResponseDto<JsonElement>
        {
            Type = type,
            RequestId = requestId,
            Backend = backend,
            Documents = null,
            Outcome = "failed",
            Data = NullElement(),
            Error = new HopperErrorDto
            {
                Code = code,
                Message = message,
                Retryable = retryable,
            },
        };

        private static int EncodingByteLength(string json) => System.Text.Encoding.UTF8.GetByteCount(json);

        internal static JsonElement NullElement() =>
            JsonSerializer.SerializeToElement<object>(null);
    }
}
