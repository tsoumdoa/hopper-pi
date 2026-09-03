using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Protocol;
using Hopper.Core.Time;
using DomainLifecycleSnapshot = Hopper.Core.Lifecycle.LifecycleSnapshot;
using DomainLifecycleState = Hopper.Core.Lifecycle.LifecycleState;
using ProtocolLifecycleState = Hopper.Core.Protocol.LifecycleState;

namespace Hopper.Core.Runtime;

public enum RuntimeStatusComponent
{
    Transport,
    Host,
    Rhino,
    Grasshopper,
    Dispatcher,
}

public sealed record HostRuntimeStatusUpdate(
    DomainLifecycleState State,
    int? ProcessId,
    string? NodePath,
    string? NodeVersion,
    HandshakeState Handshake,
    int HealthFailureCount);

/// <summary>
/// Holds the shared RPC v2 status DTO itself. Writers replace the complete immutable
/// value under a lock, and readers take one reference without calling host APIs.
/// </summary>
public sealed class RuntimeStatusStore
{
    private readonly object _gate = new();
    private readonly IHopperClock _clock;
    private RuntimeStatusV2 _current;

    public RuntimeStatusStore(
        IHopperClock clock,
        DispatcherStatus dispatcher,
        GrasshopperCapabilityStatus grasshopper)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(grasshopper);
        ValidateDispatcher(dispatcher);
        var observedAt = ToUnixMilliseconds(_clock.UtcNow, nameof(clock));
        var grasshopperError = MapGrasshopperError(grasshopper);
        _current = new RuntimeStatusV2
        {
            ProtocolVersion = RpcV2Contract.ProtocolVersion,
            Revision = 0,
            ObservedAt = observedAt,
            Lifecycle = new LifecycleStatusV2
            {
                State = ProtocolLifecycleState.stopped,
                ChangedAt = observedAt,
                Reason = null,
            },
            Transport = new TransportStatusV2
            {
                Ready = false,
                LifecycleInstanceId = null,
            },
            Host = new HostStatusV2
            {
                State = ProtocolLifecycleState.stopped,
                ProcessId = null,
                NodePath = null,
                NodeVersion = null,
                Handshake = HandshakeState.disconnected,
                HealthFailureCount = 0,
            },
            Rhino = new DocumentStatusV2
            {
                ActiveDocument = false,
                DocumentName = null,
            },
            Grasshopper = new GrasshopperStatusV2
            {
                State = MapGrasshopperState(grasshopper.State),
                ActiveDocument = false,
                DocumentName = null,
            },
            Dispatcher = MapDispatcher(dispatcher),
            Errors = new ComponentErrorsV2
            {
                Transport = null,
                Host = null,
                Rhino = null,
                Grasshopper = grasshopperError,
                Dispatcher = null,
            },
        };
    }

    public RuntimeStatusV2 Read() => Volatile.Read(ref _current);

    public bool UpdateLifecycle(DomainLifecycleSnapshot lifecycle)
    {
        ArgumentNullException.ThrowIfNull(lifecycle);
        if (lifecycle.ConsecutiveHealthFailures < 0)
            throw new ArgumentOutOfRangeException(nameof(lifecycle));
        var changedAt = ToUnixMilliseconds(lifecycle.ChangedAt, nameof(lifecycle));
        var state = MapLifecycleState(lifecycle.State);
        var reason = MapLifecycleError(lifecycle);
        return Update(current => current with
        {
            Lifecycle = current.Lifecycle with
            {
                State = state,
                ChangedAt = changedAt,
                Reason = reason,
            },
            Host = current.Host with
            {
                HealthFailureCount = lifecycle.ConsecutiveHealthFailures,
            },
        });
    }

    public bool UpdateTransport(bool ready, string? lifecycleInstanceId)
    {
        if (ready && lifecycleInstanceId is null)
            throw new ArgumentException("A ready transport requires a lifecycle instance ID.", nameof(lifecycleInstanceId));
        if (lifecycleInstanceId is not null)
            ValidateIdentifier(lifecycleInstanceId, nameof(lifecycleInstanceId));
        return Update(current => current with
        {
            Transport = current.Transport with
            {
                Ready = ready,
                LifecycleInstanceId = lifecycleInstanceId,
            },
        });
    }

    public bool UpdateHost(HostRuntimeStatusUpdate host)
    {
        ArgumentNullException.ThrowIfNull(host);
        if (host.ProcessId <= 0)
            throw new ArgumentOutOfRangeException(nameof(host), "Process ID must be positive or null.");
        if (host.HealthFailureCount < 0)
            throw new ArgumentOutOfRangeException(nameof(host), "Health failure count cannot be negative.");
        if (!Enum.IsDefined(typeof(HandshakeState), host.Handshake))
            throw new ArgumentOutOfRangeException(nameof(host));
        return Update(current => current with
        {
            Host = new HostStatusV2
            {
                State = MapLifecycleState(host.State),
                ProcessId = host.ProcessId,
                NodePath = host.NodePath,
                NodeVersion = host.NodeVersion,
                Handshake = host.Handshake,
                HealthFailureCount = host.HealthFailureCount,
            },
        });
    }

    public bool UpdateRhinoDocument(bool activeDocument, string? documentName)
    {
        ValidateDocument(activeDocument, documentName);
        return Update(current => current with
        {
            Rhino = new DocumentStatusV2
            {
                ActiveDocument = activeDocument,
                DocumentName = documentName,
            },
        });
    }

    public bool UpdateGrasshopper(
        GrasshopperCapabilityStatus capability,
        bool activeDocument,
        string? documentName)
    {
        ArgumentNullException.ThrowIfNull(capability);
        ValidateDocument(activeDocument, documentName);
        if (activeDocument && capability.State != GrasshopperCapabilityState.Ready)
            throw new ArgumentException("An active Grasshopper document requires ready capability.", nameof(capability));
        var error = MapGrasshopperError(capability);
        return Update(current => current with
        {
            Grasshopper = new GrasshopperStatusV2
            {
                State = MapGrasshopperState(capability.State),
                ActiveDocument = activeDocument,
                DocumentName = documentName,
            },
            Errors = current.Errors with { Grasshopper = error },
        });
    }

    public bool UpdateDispatcher(DispatcherStatus dispatcher)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        ValidateDispatcher(dispatcher);
        return Update(current => current with
        {
            Dispatcher = MapDispatcher(dispatcher),
        });
    }

    public bool UpdateError(RuntimeStatusComponent component, RuntimeErrorV2? error)
    {
        ValidateError(error);
        return Update(current => current with
        {
            Errors = component switch
            {
                RuntimeStatusComponent.Transport => current.Errors with { Transport = error },
                RuntimeStatusComponent.Host => current.Errors with { Host = error },
                RuntimeStatusComponent.Rhino => current.Errors with { Rhino = error },
                RuntimeStatusComponent.Grasshopper => current.Errors with { Grasshopper = error },
                RuntimeStatusComponent.Dispatcher => current.Errors with { Dispatcher = error },
                _ => throw new ArgumentOutOfRangeException(nameof(component), component, null),
            },
        });
    }

    private bool Update(Func<RuntimeStatusV2, RuntimeStatusV2> change)
    {
        lock (_gate)
        {
            var current = _current;
            var changed = change(current);
            if (changed == current)
                return false;

            changed = changed with
            {
                ProtocolVersion = RpcV2Contract.ProtocolVersion,
                Revision = checked(current.Revision + 1),
                ObservedAt = ToUnixMilliseconds(_clock.UtcNow, nameof(_clock)),
            };
            Volatile.Write(ref _current, changed);
            return true;
        }
    }

    private static DispatcherStatusV2 MapDispatcher(DispatcherStatus dispatcher) =>
        new()
        {
            AcceptingExternalWork = dispatcher.AcceptingExternalWork,
            Depth = dispatcher.ExternalDepth,
            Capacity = dispatcher.ExternalCapacity,
        };

    private static ProtocolLifecycleState MapLifecycleState(DomainLifecycleState state) => state switch
    {
        DomainLifecycleState.Stopped => ProtocolLifecycleState.stopped,
        DomainLifecycleState.Starting => ProtocolLifecycleState.starting,
        DomainLifecycleState.Running => ProtocolLifecycleState.running,
        DomainLifecycleState.Stopping => ProtocolLifecycleState.stopping,
        DomainLifecycleState.Faulted => ProtocolLifecycleState.faulted,
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
    };

    private static GrasshopperState MapGrasshopperState(GrasshopperCapabilityState state) => state switch
    {
        GrasshopperCapabilityState.NotInstalled => GrasshopperState.not_installed,
        GrasshopperCapabilityState.NotLoaded => GrasshopperState.not_loaded,
        GrasshopperCapabilityState.Loading => GrasshopperState.loading,
        GrasshopperCapabilityState.Ready => GrasshopperState.ready,
        GrasshopperCapabilityState.Failed => GrasshopperState.failed,
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
    };

    private static RuntimeErrorV2? MapLifecycleError(DomainLifecycleSnapshot lifecycle)
    {
        var code = lifecycle.Reason switch
        {
            Lifecycle.LifecycleReasonCode.NodeResolutionFailed => RpcReasonCode.CAPABILITY_UNAVAILABLE,
            Lifecycle.LifecycleReasonCode.HandshakeFailed => RpcReasonCode.HANDSHAKE_REJECTED,
            Lifecycle.LifecycleReasonCode.DispatcherUnavailable => RpcReasonCode.DISPATCHER_BUSY,
            Lifecycle.LifecycleReasonCode.TransactionCleanupFailed => RpcReasonCode.OPERATION_FAILED,
            Lifecycle.LifecycleReasonCode.TransactionCleanupTimeout => RpcReasonCode.OPERATION_FAILED,
            Lifecycle.LifecycleReasonCode.TransportStartFailed => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.ProfileWriteFailed => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.ChildLaunchFailed => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.ChildStillAlive => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.TransportStopTimeout => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.ProfileDeleteFailed => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.UnexpectedChildExit => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.HealthCheckFailed => RpcReasonCode.INTERNAL_ERROR,
            Lifecycle.LifecycleReasonCode.HealthFailureThresholdReached => RpcReasonCode.INTERNAL_ERROR,
            _ => (RpcReasonCode?)null,
        };
        return code is null
            ? null
            : new RuntimeErrorV2
            {
                Code = code.Value,
                Message = string.IsNullOrWhiteSpace(lifecycle.Message)
                    ? lifecycle.Reason.ToString()
                    : lifecycle.Message,
            };
    }

    private static RuntimeErrorV2? MapGrasshopperError(GrasshopperCapabilityStatus capability)
    {
        if (capability.Error is null)
            return null;
        if (string.IsNullOrWhiteSpace(capability.Error.Message))
            throw new ArgumentException("Grasshopper error message cannot be empty.", nameof(capability));
        return new RuntimeErrorV2
        {
            Code = capability.State == GrasshopperCapabilityState.NotInstalled
                ? RpcReasonCode.GRASSHOPPER_NOT_INSTALLED
                : RpcReasonCode.GRASSHOPPER_START_FAILED,
            Message = capability.Error.Message,
        };
    }

    private static void ValidateDispatcher(DispatcherStatus dispatcher)
    {
        if (dispatcher.ExternalCapacity <= 0)
            throw new ArgumentOutOfRangeException(nameof(dispatcher), "Dispatcher capacity must be positive.");
        if (dispatcher.ExternalDepth < 0 || dispatcher.ExternalDepth > dispatcher.ExternalCapacity)
            throw new ArgumentOutOfRangeException(nameof(dispatcher), "Dispatcher depth must be within capacity.");
    }

    private static void ValidateDocument(bool activeDocument, string? documentName)
    {
        if (!activeDocument && documentName is not null)
            throw new ArgumentException("An inactive document cannot have a name.", nameof(documentName));
    }

    private static void ValidateError(RuntimeErrorV2? error)
    {
        if (error is null)
            return;
        if (!Enum.IsDefined(typeof(RpcReasonCode), error.Code))
            throw new ArgumentOutOfRangeException(nameof(error));
        if (string.IsNullOrWhiteSpace(error.Message))
            throw new ArgumentException("Runtime error message cannot be empty.", nameof(error));
    }

    private static void ValidateIdentifier(string value, string parameterName)
    {
        if (value.Length is not (> 0 and <= 128)
            || !char.IsLetterOrDigit(value[0])
            || value.Any(character => !char.IsLetterOrDigit(character) && character is not ('.' or '_' or ':' or '-')))
            throw new ArgumentException("Lifecycle instance ID is invalid.", parameterName);
    }

    private static long ToUnixMilliseconds(DateTimeOffset value, string parameterName)
    {
        var milliseconds = value.ToUnixTimeMilliseconds();
        if (milliseconds < 0)
            throw new ArgumentOutOfRangeException(parameterName, "Status timestamps cannot precede the Unix epoch.");
        return milliseconds;
    }
}
