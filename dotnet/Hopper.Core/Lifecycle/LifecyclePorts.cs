namespace Hopper.Core.Lifecycle;

public sealed record LifecycleActionResult(bool Succeeded, string Message)
{
    public static LifecycleActionResult Success(string message = "") => new(true, message);
    public static LifecycleActionResult Failure(string message) => new(false, message);
}

public sealed record LifecycleTransportConnection(
    string RouterEndpoint,
    string PublisherEndpoint,
    string AuthenticationToken);

public sealed record TransportStartResult(
    bool Succeeded,
    bool ResourceCreated,
    LifecycleTransportConnection? Connection,
    string Message);

public sealed record ProfileWriteResult(
    bool Succeeded,
    bool ResourceCreated,
    string? ProfilePath,
    string Message);

public sealed record ChildStartResult(
    bool Succeeded,
    bool ResourceCreated,
    string Message);

public interface ILifecycleInstanceIdSource
{
    string Create();
}

public interface ILifecycleBackgroundScheduler
{
    Task Schedule(Func<Task> operation);
}

public sealed class ThreadPoolLifecycleBackgroundScheduler : ILifecycleBackgroundScheduler
{
    public Task Schedule(Func<Task> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return Task.Run(operation);
    }
}

public interface ILifecycleTransport
{
    bool IsRunning { get; }

    Task<TransportStartResult> StartAsync(
        string lifecycleInstanceId,
        CancellationToken cancellationToken);

    Task<LifecycleActionResult> WaitForAuthenticatedHandshakeAsync(
        string lifecycleInstanceId,
        TimeSpan timeout,
        CancellationToken cancellationToken);

    Task<bool> StopAsync(TimeSpan timeout, CancellationToken cancellationToken);
    void SignalStopNoWait();
}

public interface IInstanceProfileStore
{
    Task<ProfileWriteResult> WriteAsync(
        string lifecycleInstanceId,
        LifecycleTransportConnection connection,
        CancellationToken cancellationToken);

    Task<LifecycleActionResult> DeleteOwnedAsync(
        string lifecycleInstanceId,
        CancellationToken cancellationToken);
}

public interface IManagedChildProcess
{
    bool IsAlive { get; }

    Task<ChildStartResult> StartAsync(
        NodeRuntime runtime,
        string profilePath,
        string lifecycleInstanceId,
        CancellationToken cancellationToken);

    Task<bool> RequestGracefulStopAsync(TimeSpan timeout, CancellationToken cancellationToken);
    void KillVerifiedTreeNoWait();
    Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken);
}

public interface IAgentTransactionCleanup
{
    void CleanupOpenTransactions();
}
