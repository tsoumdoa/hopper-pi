namespace Hopper.Core.Dispatching;

public enum DispatcherResultKind
{
    Completed,
    Failed,
    Busy,
    DeadlineExceededBeforeStart,
    CancelledBeforeStart,
    ShuttingDown,
}

public sealed record DispatcherResult<T>
{
    private DispatcherResult(
        DispatcherResultKind kind,
        T? value = default,
        Exception? exception = null,
        int? depth = null,
        int? capacity = null)
    {
        Kind = kind;
        Value = value;
        Exception = exception;
        Depth = depth;
        Capacity = capacity;
    }

    public DispatcherResultKind Kind { get; }
    public T? Value { get; }
    public Exception? Exception { get; }
    public int? Depth { get; }
    public int? Capacity { get; }

    public string Code => Kind switch
    {
        DispatcherResultKind.Completed => "OK",
        DispatcherResultKind.Failed => "OPERATION_FAILED",
        DispatcherResultKind.Busy => "DISPATCHER_BUSY",
        DispatcherResultKind.DeadlineExceededBeforeStart => "START_DEADLINE_EXCEEDED",
        DispatcherResultKind.CancelledBeforeStart => "CANCELLED_BEFORE_START",
        DispatcherResultKind.ShuttingDown => "SHUTTING_DOWN",
        _ => throw new InvalidOperationException($"Unknown dispatcher result kind: {Kind}"),
    };

    public static DispatcherResult<T> Completed(T? value) =>
        new(DispatcherResultKind.Completed, value);

    public static DispatcherResult<T> Failed(Exception exception) =>
        new(DispatcherResultKind.Failed, exception: exception);

    public static DispatcherResult<T> Busy(int depth, int capacity) =>
        new(DispatcherResultKind.Busy, depth: depth, capacity: capacity);

    public static DispatcherResult<T> DeadlineExceededBeforeStart() =>
        new(DispatcherResultKind.DeadlineExceededBeforeStart);

    public static DispatcherResult<T> CancelledBeforeStart() =>
        new(DispatcherResultKind.CancelledBeforeStart);

    public static DispatcherResult<T> ShuttingDown() =>
        new(DispatcherResultKind.ShuttingDown);
}

public sealed record DispatcherStatus(
    bool AcceptingExternalWork,
    bool IsShutdown,
    bool IsRunning,
    int ExternalDepth,
    int ExternalCapacity,
    int LifecycleDepth,
    int LifecycleCapacity);
