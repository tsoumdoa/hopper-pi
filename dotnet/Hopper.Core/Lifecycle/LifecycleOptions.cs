namespace Hopper.Core.Lifecycle;

public sealed record LifecycleOptions(
    TimeSpan HandshakeTimeout,
    TimeSpan GracefulChildStopTimeout,
    TimeSpan KilledChildExitTimeout,
    TimeSpan TransportStopTimeout,
    TimeSpan TransactionCleanupStartTimeout,
    int HealthFailureThreshold)
{
    public static LifecycleOptions Default { get; } = new(
        TimeSpan.FromSeconds(60),
        TimeSpan.FromSeconds(3),
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(2),
        3);
}
