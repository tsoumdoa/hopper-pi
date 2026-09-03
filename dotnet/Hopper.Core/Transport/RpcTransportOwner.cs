using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hopper.Core.Dispatching;
using Hopper.Core.Protocol;
using Hopper.Core.Time;
using NetMQ;
using NetMQ.Sockets;

namespace Hopper.Core.Transport;

public sealed record RpcTransportOwnerOptions
{
    public required string RouterEndpoint { get; init; }
    public required string PublisherEndpoint { get; init; }
    public required string ConnectionToken { get; init; }
    public required string LifecycleInstanceId { get; init; }
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(5);
    public TimeSpan StartTimeout { get; init; } = TimeSpan.FromSeconds(5);

    internal void Validate()
    {
        RequireEndpoint(RouterEndpoint, nameof(RouterEndpoint));
        RequireEndpoint(PublisherEndpoint, nameof(PublisherEndpoint));
        if (RouterEndpoint == PublisherEndpoint)
            throw new ArgumentException("ROUTER and PUB endpoints must differ.");
        if (!IsIdentifier(LifecycleInstanceId))
            throw new ArgumentException("Lifecycle instance ID is invalid.", nameof(LifecycleInstanceId));
        if (!IsToken(ConnectionToken))
            throw new ArgumentException("Connection token must be 32 to 128 base64url characters.", nameof(ConnectionToken));
        if (PollInterval <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(PollInterval));
        if (StartTimeout <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(StartTimeout));
    }

    private static void RequireEndpoint(string endpoint, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(endpoint))
            throw new ArgumentException("Endpoint is required.", parameterName);
    }

    private static bool IsIdentifier(string value) =>
        value.Length is > 0 and <= 128
        && char.IsLetterOrDigit(value[0])
        && value.All(character => char.IsLetterOrDigit(character) || character is '.' or '_' or ':' or '-');

    private static bool IsToken(string value) =>
        value.Length is >= 32 and <= 128
        && value.All(character => char.IsLetterOrDigit(character) || character is '_' or '-');
}

public interface IRpcOperationHandler
{
    OperationResultV2 Execute(RpcRequestV2 request);
}

public sealed record AuthenticatedRpcHandshake(
    int NodeProcessId,
    string NodeVersion,
    string ClientIdentity,
    long StatusRevision);

public interface IRpcHandshakeObserver
{
    long OnAuthenticatedHandshake(LifecycleHandshakeArgsV2 handshake);
}

public enum RpcTransportStartState
{
    Started,
    AlreadyStarted,
    TimedOut,
    Failed,
}

public sealed record RpcTransportStartResult(
    RpcTransportStartState State,
    string? Error);

public enum RpcTransportStopState
{
    Stopped,
    AlreadyStopped,
    TimedOut,
    OwnerThreadCannotJoin,
}

public sealed record RpcTransportStopResult(
    RpcTransportStopState State,
    TimeSpan JoinDeadline);

public sealed record RpcTransportOwnerStatus(
    bool IsRunning,
    int? OwnerThreadId,
    long MandatoryDeliveryFailureCount,
    string? LastDeliveryError);

/// <summary>
/// Creates, polls, sends on, and disposes both NetMQ sockets on one owner thread.
/// Other threads can only enqueue response or publication data.
/// </summary>
public sealed class RpcTransportOwner : IDisposable
{
    private const long MaximumUnixMilliseconds = 253_402_300_799_999;
    private readonly object _stateGate = new();
    private readonly RpcTransportOwnerOptions _options;
    private readonly OrderedDispatcher _dispatcher;
    private readonly IRpcOperationHandler _handler;
    private readonly IRpcHandshakeObserver? _handshakeObserver;
    private readonly IHopperClock _clock;
    private readonly MutationResultStore<OperationResultV2> _resultStore;
    private readonly ConcurrentQueue<OutboundResponse> _responses = new();
    private readonly ConcurrentQueue<Publication> _publications = new();
    private readonly ManualResetEventSlim _started = new(false);
    private readonly ManualResetEventSlim _stopped = new(true);
    private readonly TaskCompletionSource<AuthenticatedRpcHandshake> _authenticatedHandshake =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource _stop = new();
    private Thread? _thread;
    private Exception? _startFailure;
    private bool _startCalled;
    private bool _disposed;
    private int _ownerThreadId;
    private long _mandatoryDeliveryFailureCount;
    private string? _lastDeliveryError;

    public RpcTransportOwner(
        RpcTransportOwnerOptions options,
        OrderedDispatcher dispatcher,
        IRpcOperationHandler handler,
        IHopperClock clock,
        MutationResultStore<OperationResultV2>? resultStore = null,
        IRpcHandshakeObserver? handshakeObserver = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _options.Validate();
        _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
        _handler = handler ?? throw new ArgumentNullException(nameof(handler));
        _handshakeObserver = handshakeObserver;
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _resultStore = resultStore ?? CreateResultStore(clock);
    }

    public RpcTransportOwnerStatus Status
    {
        get
        {
            lock (_stateGate)
            {
                return new RpcTransportOwnerStatus(
                    _started.IsSet && !_stopped.IsSet && _startFailure is null,
                    _ownerThreadId == 0 ? null : _ownerThreadId,
                    Interlocked.Read(ref _mandatoryDeliveryFailureCount),
                    _lastDeliveryError);
            }
        }
    }

    public MutationResultStoreSnapshot ResultStoreStatus => _resultStore.GetSnapshot();

    public CancelOperationState CancelOperation(string operationId)
    {
        var lookup = _resultStore.Lookup(operationId);
        if (lookup.State == MutationLookupState.NotFound)
            return CancelOperationState.not_found;
        if (lookup.State == MutationLookupState.Terminal)
        {
            var terminal = DeserializeRetained(lookup.TerminalResult!);
            return terminal.ReasonCode == RpcReasonCode.CANCELLED_BEFORE_START
                ? CancelOperationState.already_cancelled
                : CancelOperationState.rejected_already_started;
        }

        return _dispatcher.CancelQueuedExternal(operationId) switch
        {
            DispatcherCancellationState.CancelledBeforeStart =>
                CancelOperationState.cancelled_before_start,
            DispatcherCancellationState.RejectedAlreadyStarted =>
                CancelOperationState.rejected_already_started,
            // An admitted pending operation that is no longer queued has started or
            // is completing its terminal-result continuation.
            DispatcherCancellationState.NotFound =>
                CancelOperationState.rejected_already_started,
            _ => throw new InvalidOperationException("Unexpected dispatcher cancellation state."),
        };
    }

    public async Task<AuthenticatedRpcHandshake?> WaitForAuthenticatedHandshakeAsync(
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        if (timeout <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(timeout));
        try
        {
            return await _authenticatedHandshake.Task.WaitAsync(timeout, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            return null;
        }
    }

    public RpcTransportStartResult Start()
    {
        lock (_stateGate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_startCalled)
                return new RpcTransportStartResult(RpcTransportStartState.AlreadyStarted, null);

            _startCalled = true;
            _stopped.Reset();
            _thread = new Thread(Run)
            {
                IsBackground = true,
                Name = "Hopper NetMQ transport owner",
            };
            _thread.Start();
        }

        if (!_started.Wait(_options.StartTimeout))
            return new RpcTransportStartResult(RpcTransportStartState.TimedOut, "Transport bind did not finish before the start timeout.");

        lock (_stateGate)
        {
            return _startFailure is null
                ? new RpcTransportStartResult(RpcTransportStartState.Started, null)
                : new RpcTransportStartResult(RpcTransportStartState.Failed, _startFailure.Message);
        }
    }

    public void Publish(string topic, string json)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(topic))
            throw new ArgumentException("Publication topic is required.", nameof(topic));
        using var _ = JsonDocument.Parse(json);
        _publications.Enqueue(new Publication(topic, json));
    }

    public RpcTransportStopResult Stop(TimeSpan joinDeadline)
    {
        if (joinDeadline < TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(joinDeadline));

        Thread? thread;
        lock (_stateGate)
        {
            if (!_startCalled || _stopped.IsSet)
                return new RpcTransportStopResult(RpcTransportStopState.AlreadyStopped, joinDeadline);
            thread = _thread;
            _stop.Cancel();
        }

        if (thread == Thread.CurrentThread)
            return new RpcTransportStopResult(RpcTransportStopState.OwnerThreadCannotJoin, joinDeadline);
        return thread is not null && thread.Join(joinDeadline)
            ? new RpcTransportStopResult(RpcTransportStopState.Stopped, joinDeadline)
            : new RpcTransportStopResult(RpcTransportStopState.TimedOut, joinDeadline);
    }

    public void Dispose()
    {
        lock (_stateGate)
        {
            if (_disposed)
                return;
            _disposed = true;
        }

        _ = Stop(TimeSpan.FromSeconds(2));
        if (_stopped.IsSet)
        {
            _started.Dispose();
            _stopped.Dispose();
            _stop.Dispose();
        }
    }

    private void Run()
    {
        Volatile.Write(ref _ownerThreadId, Environment.CurrentManagedThreadId);
        RouterSocket? router = null;
        PublisherSocket? publisher = null;
        try
        {
            router = new RouterSocket();
            publisher = new PublisherSocket();
            router.Options.Linger = TimeSpan.Zero;
            router.Options.RouterMandatory = true;
            router.Options.RouterHandover = true;
            publisher.Options.Linger = TimeSpan.Zero;
            router.Bind(_options.RouterEndpoint);
            publisher.Bind(_options.PublisherEndpoint);
            _started.Set();

            while (!_stop.IsCancellationRequested)
            {
                DrainResponses(router);
                DrainPublications(publisher);
                ReceiveOne(router);
            }
        }
        catch (Exception exception)
        {
            lock (_stateGate)
            {
                if (!_started.IsSet)
                    _startFailure = exception;
                else
                    _lastDeliveryError = exception.Message;
            }
            _started.Set();
        }
        finally
        {
            ReleaseSocket(router, _options.RouterEndpoint);
            ReleaseSocket(publisher, _options.PublisherEndpoint);
            _stopped.Set();
        }
    }

    private static void ReleaseSocket(NetMQSocket? socket, string endpoint)
    {
        if (socket is null)
            return;
        try
        {
            socket.Unbind(endpoint);
        }
        catch
        {
            // A partially started socket may never have bound.
        }
        socket.Dispose();
    }

    private void ReceiveOne(RouterSocket router)
    {
        var message = new NetMQMessage();
        if (!router.TryReceiveMultipartMessage(_options.PollInterval, ref message))
            return;
        if (message.FrameCount != 2)
            return;

        var routingIdentity = message[0].ToByteArray();
        var payload = message[1].ConvertToString(Encoding.UTF8);
        HandlePayload(routingIdentity, payload);
    }

    private void HandlePayload(byte[] routingIdentity, string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            if (!TryReadIdentifier(root, "requestId", out var requestId))
                return;

            var lifecycleInstanceId = ReadOptionalString(root, "lifecycleInstanceId");
            var operationText = ReadOptionalString(root, "operation");
            if (!HasProtocolVersion(root))
            {
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    lifecycleInstanceId,
                    operationText,
                    RpcReasonCode.PROTOCOL_VERSION_UNSUPPORTED,
                    "The server accepts protocol version 2.");
                return;
            }
            if (!HasValidToken(root))
            {
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    lifecycleInstanceId,
                    operationText,
                    RpcReasonCode.AUTH_INVALID,
                    "Authentication failed.");
                return;
            }
            if (!TryReadIdentifier(root, "lifecycleInstanceId", out lifecycleInstanceId))
            {
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    null,
                    operationText,
                    RpcReasonCode.MALFORMED_REQUEST,
                    "lifecycleInstanceId is required.");
                return;
            }
            if (!Enum.TryParse<RpcOperation>(operationText, false, out var operation)
                || !Enum.IsDefined(typeof(RpcOperation), operation))
            {
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    lifecycleInstanceId,
                    operationText,
                    RpcReasonCode.UNKNOWN_OPERATION,
                    $"Operation {operationText ?? "<missing>"} is not defined by protocol v2.");
                return;
            }
            if (!FixedTimeEquals(lifecycleInstanceId, _options.LifecycleInstanceId))
            {
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    lifecycleInstanceId,
                    operationText,
                    RpcReasonCode.LIFECYCLE_INSTANCE_STALE,
                    "Lifecycle instance does not match the running transport.");
                return;
            }

            var parsed = RpcV2Contract.ParseRequest(payload);
            if (!parsed.IsValid || parsed.Value is null)
            {
                var reason = ClassifyMalformedRequest(root, operation);
                QueueProtocolError(
                    routingIdentity,
                    requestId,
                    lifecycleInstanceId,
                    operationText,
                    reason,
                    string.Join("; ", parsed.Errors));
                return;
            }

            var request = parsed.Value;
            if (_clock.UtcNow.ToUnixTimeMilliseconds() >= request.StartDeadlineAt)
            {
                QueueOperationResponse(
                    routingIdentity,
                    request,
                    Result(RpcResultClass.deadline_exceeded_before_start, RpcReasonCode.START_DEADLINE_EXCEEDED));
                return;
            }

            if (request.Operation == RpcOperation.getOperationResult)
            {
                QueueLookupResponse(routingIdentity, request);
                return;
            }

            if (request.Operation == RpcOperation.cancelOperation)
            {
                // Cancellation must run before the target reaches the UI queue head.
                // The host handler for this control operation may only use thread-safe
                // cancellation state and must not call Rhino or Grasshopper APIs.
                QueueOperationResponse(routingIdentity, request, _handler.Execute(request));
                return;
            }

            if (request.Operation == RpcOperation.lifecycleHandshake)
            {
                CompleteAuthenticatedHandshake(routingIdentity, request);
                return;
            }

            if (RpcV2Operations.Classify(request.Operation) == RpcOperationClass.Mutation
                && !AdmitMutation(routingIdentity, request))
                return;

            Dispatch(routingIdentity, request);
        }
        catch (JsonException)
        {
            // Without a parsed request ID there is no safe correlation target.
        }
        catch (Exception exception)
        {
            lock (_stateGate)
                _lastDeliveryError = exception.Message;
        }
    }

    private void CompleteAuthenticatedHandshake(byte[] routingIdentity, RpcRequestV2 request)
    {
        var args = request.Args.Deserialize<LifecycleHandshakeArgsV2>(RpcV2Contract.JsonOptions)!;
        var routedIdentity = Encoding.UTF8.GetString(routingIdentity);
        if (!FixedTimeEquals(args.ClientIdentity, routedIdentity))
        {
            QueueOperationResponse(
                routingIdentity,
                request,
                Result(RpcResultClass.failed, RpcReasonCode.AUTH_INVALID, "Handshake identity does not match the DEALER route."));
            return;
        }

        try
        {
            var statusRevision = _handshakeObserver?.OnAuthenticatedHandshake(args) ?? 0;
            var handshake = new AuthenticatedRpcHandshake(
                args.NodeProcessId,
                args.NodeVersion,
                args.ClientIdentity,
                statusRevision);
            _authenticatedHandshake.TrySetResult(handshake);
            QueueOperationResponse(
                routingIdentity,
                request,
                Result(
                    RpcResultClass.completed,
                    RpcReasonCode.OK,
                    data: JsonSerializer.SerializeToElement(
                        new LifecycleHandshakeDataV2
                        {
                            Handshake = HandshakeState.live,
                            StatusRevision = statusRevision,
                        },
                        RpcV2Contract.JsonOptions)));
        }
        catch (Exception exception)
        {
            QueueOperationResponse(
                routingIdentity,
                request,
                Result(RpcResultClass.failed, RpcReasonCode.INTERNAL_ERROR, exception.Message));
        }
    }

    private bool AdmitMutation(byte[] routingIdentity, RpcRequestV2 request)
    {
        var admission = _resultStore.Admit(OperationRetentionKind.Mutation, request.OperationId);
        switch (admission.State)
        {
            case MutationAdmissionState.Admitted:
                return true;
            case MutationAdmissionState.ExistingTerminal:
                QueueOperationResponse(routingIdentity, request, DeserializeRetained(admission.TerminalResult!));
                return false;
            case MutationAdmissionState.ExistingPending:
                QueueOperationResponse(
                    routingIdentity,
                    request,
                    Result(RpcResultClass.busy, RpcReasonCode.DISPATCHER_BUSY, "Operation is already pending."));
                return false;
            case MutationAdmissionState.Busy:
                QueueOperationResponse(
                    routingIdentity,
                    request,
                    Result(RpcResultClass.busy, RpcReasonCode.RESULT_STORE_FULL, "Mutation result store is full."));
                return false;
            default:
                throw new InvalidOperationException($"Unexpected mutation admission state: {admission.State}");
        }
    }

    private void Dispatch(byte[] routingIdentity, RpcRequestV2 request)
    {
        var deadline = request.StartDeadlineAt > MaximumUnixMilliseconds
            ? DateTimeOffset.MaxValue
            : DateTimeOffset.FromUnixTimeMilliseconds(request.StartDeadlineAt);
        var completion = _dispatcher.SubmitExternal(
            () => _handler.Execute(request),
            deadline,
            operationId: request.OperationId);
        _ = completion.ContinueWith(
            task => CompleteDispatch(routingIdentity, request, task),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void CompleteDispatch(
        byte[] routingIdentity,
        RpcRequestV2 request,
        Task<DispatcherResult<OperationResultV2>> completion)
    {
        var result = completion.IsCompletedSuccessfully
            ? MapDispatcherResult(completion.Result)
            : Result(RpcResultClass.failed, RpcReasonCode.INTERNAL_ERROR, "Dispatcher completion failed.");
        var isMutation = RpcV2Operations.Classify(request.Operation) == RpcOperationClass.Mutation;
        if (isMutation)
        {
            // Every dispatcher outcome is terminal for this admitted mutation,
            // including rejection before start. Retaining it lets the same Node
            // process recover a reply lost while the route was disconnected.
            var retained = _resultStore.Complete(request.OperationId!, result);
            result = DeserializeRetained(retained.TerminalResult!);
        }
        QueueOperationResponse(routingIdentity, request, result);
    }

    private void QueueLookupResponse(byte[] routingIdentity, RpcRequestV2 request)
    {
        var args = request.Args.Deserialize<OperationReferenceArgsV2>(RpcV2Contract.JsonOptions)!;
        var lookup = _resultStore.Lookup(args.OperationId);
        var data = lookup.State switch
        {
            MutationLookupState.Pending => new OperationLookupDataV2
            {
                State = OperationLookupState.pending,
                Phase = OperationPhase.queued,
            },
            MutationLookupState.Terminal => new OperationLookupDataV2
            {
                State = OperationLookupState.terminal,
                Result = DeserializeRetained(lookup.TerminalResult!),
            },
            _ => new OperationLookupDataV2 { State = OperationLookupState.not_found },
        };
        QueueOperationResponse(
            routingIdentity,
            request,
            Result(
                RpcResultClass.completed,
                RpcReasonCode.OK,
                data: JsonSerializer.SerializeToElement(data, RpcV2Contract.JsonOptions)));
    }

    private void QueueProtocolError(
        byte[] routingIdentity,
        string requestId,
        string? lifecycleInstanceId,
        string? operation,
        RpcReasonCode reason,
        string message)
    {
        var response = new ProtocolErrorResponseV2
        {
            ProtocolVersion = RpcV2Contract.ProtocolVersion,
            RequestId = requestId,
            LifecycleInstanceId = lifecycleInstanceId,
            Operation = operation,
            Result = Result(RpcResultClass.failed, reason, message),
        };
        _responses.Enqueue(new OutboundResponse(routingIdentity, RpcV2Contract.SerializeResponse(response)));
    }

    private void QueueOperationResponse(byte[] routingIdentity, RpcRequestV2 request, OperationResultV2 result)
    {
        var response = new OperationResponseV2
        {
            ProtocolVersion = RpcV2Contract.ProtocolVersion,
            LifecycleInstanceId = _options.LifecycleInstanceId,
            RequestId = request.RequestId,
            Operation = request.Operation,
            OperationId = request.OperationId,
            Result = result,
        };
        _responses.Enqueue(new OutboundResponse(routingIdentity, RpcV2Contract.SerializeResponse(response)));
    }

    private void DrainResponses(RouterSocket router)
    {
        while (_responses.TryDequeue(out var response))
        {
            try
            {
                var message = new NetMQMessage();
                message.Append(response.RoutingIdentity);
                message.Append(response.Json);
                router.SendMultipartMessage(message);
            }
            catch (Exception exception)
            {
                Interlocked.Increment(ref _mandatoryDeliveryFailureCount);
                lock (_stateGate)
                    _lastDeliveryError = exception.Message;
            }
        }
    }

    private void DrainPublications(PublisherSocket publisher)
    {
        while (_publications.TryDequeue(out var publication))
        {
            var message = new NetMQMessage();
            message.Append(publication.Topic);
            message.Append(publication.Json);
            publisher.SendMultipartMessage(message);
        }
    }

    private bool HasValidToken(JsonElement root)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("token", out var token)
            && token.ValueKind == JsonValueKind.String
            && FixedTimeEquals(token.GetString()!, _options.ConnectionToken);
    }

    private static bool HasProtocolVersion(JsonElement root)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("protocolVersion", out var version)
            && version.ValueKind == JsonValueKind.Number
            && version.TryGetInt32(out var value)
            && value == RpcV2Contract.ProtocolVersion;
    }

    private static RpcReasonCode ClassifyMalformedRequest(JsonElement root, RpcOperation operation)
    {
        var isMutation = RpcV2Operations.Classify(operation) == RpcOperationClass.Mutation;
        var hasOperationId = TryReadIdentifier(root, "operationId", out _);
        if (isMutation && !hasOperationId)
            return RpcReasonCode.OPERATION_ID_REQUIRED;
        if (!isMutation && root.TryGetProperty("operationId", out _))
            return RpcReasonCode.OPERATION_ID_FORBIDDEN;
        return RpcReasonCode.MALFORMED_REQUEST;
    }

    private static bool TryReadIdentifier(JsonElement root, string property, out string value)
    {
        value = string.Empty;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty(property, out var element)
            || element.ValueKind != JsonValueKind.String)
            return false;
        value = element.GetString()!;
        return value.Length is > 0 and <= 128
            && char.IsLetterOrDigit(value[0])
            && value.All(character => char.IsLetterOrDigit(character) || character is '.' or '_' or ':' or '-');
    }

    private static string? ReadOptionalString(JsonElement root, string property)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private static OperationResultV2 MapDispatcherResult(DispatcherResult<OperationResultV2> result)
    {
        return result.Kind switch
        {
            DispatcherResultKind.Completed => result.Value
                ?? Result(RpcResultClass.failed, RpcReasonCode.INTERNAL_ERROR, "Operation handler returned no result."),
            DispatcherResultKind.Failed => Result(
                RpcResultClass.failed,
                RpcReasonCode.OPERATION_FAILED,
                result.Exception?.Message ?? "Operation failed."),
            DispatcherResultKind.Busy => Result(RpcResultClass.busy, RpcReasonCode.DISPATCHER_BUSY),
            DispatcherResultKind.DeadlineExceededBeforeStart => Result(
                RpcResultClass.deadline_exceeded_before_start,
                RpcReasonCode.START_DEADLINE_EXCEEDED),
            DispatcherResultKind.CancelledBeforeStart => Result(
                RpcResultClass.cancelled_before_start,
                RpcReasonCode.CANCELLED_BEFORE_START),
            DispatcherResultKind.ShuttingDown => Result(RpcResultClass.shutting_down, RpcReasonCode.SHUTTING_DOWN),
            _ => throw new ArgumentOutOfRangeException(nameof(result)),
        };
    }

    private static OperationResultV2 Result(
        RpcResultClass resultClass,
        RpcReasonCode reasonCode,
        string? message = null,
        JsonElement? data = null) =>
        new()
        {
            Class = resultClass,
            ReasonCode = reasonCode,
            Message = message,
            Data = data,
        };

    private static MutationResultStore<OperationResultV2> CreateResultStore(IHopperClock clock)
    {
        var oversized = Result(
            RpcResultClass.failed,
            RpcReasonCode.OPERATION_RESULT_TOO_LARGE,
            "Mutation result exceeded the retained result limit.");
        return new MutationResultStore<OperationResultV2>(
            new ResultStoreClock(clock),
            new OperationResultSerializer(),
            new OperationResultTooLargeTerminal(JsonSerializer.Serialize(oversized, RpcV2Contract.JsonOptions)));
    }

    private static OperationResultV2 DeserializeRetained(RetainedMutationResult retained)
    {
        return JsonSerializer.Deserialize<OperationResultV2>(retained.Body, RpcV2Contract.JsonOptions)
            ?? throw new InvalidOperationException("Retained mutation result is invalid.");
    }

    private sealed class OperationResultSerializer : IMutationResultSerializer<OperationResultV2>
    {
        public SerializedMutationResult Serialize(OperationResultV2 result) =>
            new(JsonSerializer.Serialize(result, RpcV2Contract.JsonOptions));
    }

    private sealed class ResultStoreClock : IMutationResultStoreClock
    {
        private readonly IHopperClock _clock;

        public ResultStoreClock(IHopperClock clock)
        {
            _clock = clock;
        }

        public DateTimeOffset UtcNow => _clock.UtcNow;
    }

    private sealed record OutboundResponse(byte[] RoutingIdentity, string Json);
    private sealed record Publication(string Topic, string Json);
}
