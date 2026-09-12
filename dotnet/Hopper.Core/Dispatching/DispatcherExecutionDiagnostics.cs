using System.Diagnostics;

namespace Hopper.Core.Dispatching;

public sealed record DispatcherExecutionRecord(
    TimeSpan Duration,
    bool IsLifecycleControl,
    string? OperationId)
{
    public bool IsSlow => Duration > OrderedDispatcher.SlowExecutionWarningThreshold;
}

public interface IDispatcherDurationClock
{
    long GetTimestamp();
    TimeSpan GetElapsedTime(long startingTimestamp);
}

public sealed class StopwatchDispatcherDurationClock : IDispatcherDurationClock
{
    public static StopwatchDispatcherDurationClock Instance { get; } = new();

    private StopwatchDispatcherDurationClock()
    {
    }

    public long GetTimestamp() => Stopwatch.GetTimestamp();

    public TimeSpan GetElapsedTime(long startingTimestamp) =>
        Stopwatch.GetElapsedTime(startingTimestamp);
}
