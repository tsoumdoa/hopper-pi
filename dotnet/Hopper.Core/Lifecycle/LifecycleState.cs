namespace Hopper.Core.Lifecycle;

public enum LifecycleState
{
    Stopped,
    Starting,
    Running,
    Stopping,
    Faulted,
}

public enum LifecycleReasonCode
{
    Initialized,
    StartRequested,
    Started,
    StartIgnored,
    NodeResolutionFailed,
    TransportStartFailed,
    ProfileWriteFailed,
    ChildLaunchFailed,
    HandshakeFailed,
    DispatcherUnavailable,
    StopRequested,
    Stopped,
    StopIgnored,
    TransactionCleanupFailed,
    TransactionCleanupTimeout,
    ChildStillAlive,
    TransportStopTimeout,
    ProfileDeleteFailed,
    UnexpectedChildExit,
    HealthCheckFailed,
    HealthCheckRecovered,
    HealthFailureThresholdReached,
    RhinoClosing,
}
