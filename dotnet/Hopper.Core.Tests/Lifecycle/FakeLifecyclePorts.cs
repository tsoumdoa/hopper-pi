using Hopper.Core.Dispatching;
using Hopper.Core.Lifecycle;

namespace Hopper.Core.Tests.Lifecycle;

internal sealed class FakeProfileStore : IInstanceProfileStore
{
    public List<string>? Calls { get; set; }
    public int WriteCount { get; private set; }
    public int DeleteCount { get; private set; }
    public ProfileWriteResult WriteResult { get; set; } = new(true, true, "/profile", "");
    public LifecycleActionResult DeleteResult { get; set; } = LifecycleActionResult.Success();

    public Task<ProfileWriteResult> WriteAsync(
        string lifecycleInstanceId,
        LifecycleTransportConnection connection,
        CancellationToken cancellationToken)
    {
        WriteCount++;
        Calls?.Add("profile.write");
        return Task.FromResult(WriteResult);
    }

    public Task<LifecycleActionResult> DeleteOwnedAsync(
        string lifecycleInstanceId,
        CancellationToken cancellationToken)
    {
        DeleteCount++;
        Calls?.Add("profile.delete");
        return Task.FromResult(DeleteResult);
    }
}

internal sealed class FakeChildProcess : IManagedChildProcess
{
    public List<string>? Calls { get; set; }
    public bool IsAlive { get; private set; }
    public int StartCount { get; private set; }
    public int GracefulStopCount { get; private set; }
    public int KillCount { get; private set; }
    public int WaitCount { get; private set; }
    public TimeSpan? GracefulTimeout { get; private set; }
    public TimeSpan? WaitTimeout { get; private set; }
    public ChildStartResult StartResult { get; set; } = new(true, true, "");
    public bool GracefulStopResult { get; set; } = true;
    public bool WaitResult { get; set; } = true;

    public Task<ChildStartResult> StartAsync(
        NodeRuntime runtime,
        string profilePath,
        string lifecycleInstanceId,
        CancellationToken cancellationToken)
    {
        StartCount++;
        Calls?.Add("child.start");
        if (StartResult.ResourceCreated)
            IsAlive = true;
        return Task.FromResult(StartResult);
    }

    public Task<bool> RequestGracefulStopAsync(
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        GracefulStopCount++;
        GracefulTimeout = timeout;
        Calls?.Add("child.graceful-stop");
        if (GracefulStopResult)
            IsAlive = false;
        return Task.FromResult(GracefulStopResult);
    }

    public void KillVerifiedTreeNoWait()
    {
        KillCount++;
        Calls?.Add("child.kill");
    }

    public Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        WaitCount++;
        WaitTimeout = timeout;
        Calls?.Add("child.wait");
        if (WaitResult)
            IsAlive = false;
        return Task.FromResult(WaitResult);
    }
}

internal sealed class FakeLifecycleDispatcher : ILifecycleDispatcher
{
    public List<string>? Calls { get; set; }
    public int CloseCount { get; private set; }
    public int CancelCount { get; private set; }
    public int ReopenCount { get; private set; }
    public bool ReopenResult { get; set; } = true;
    public DateTimeOffset? LifecycleDeadline { get; private set; }
    public DispatcherResult<bool> LifecycleResult { get; set; } =
        DispatcherResult<bool>.Completed(true);

    public void CloseExternalAdmission()
    {
        CloseCount++;
        Calls?.Add("dispatcher.close");
    }

    public bool ReopenExternalAdmission()
    {
        ReopenCount++;
        Calls?.Add("dispatcher.reopen");
        return ReopenResult;
    }

    public int CancelQueuedExternal()
    {
        CancelCount++;
        Calls?.Add("dispatcher.cancel");
        return 0;
    }

    public Task<DispatcherResult<bool>> SubmitLifecycleControl(
        Action operation,
        DateTimeOffset? startDeadlineAt = null,
        CancellationToken cancellationToken = default)
    {
        Calls?.Add("dispatcher.lifecycle");
        LifecycleDeadline = startDeadlineAt;
        if (LifecycleResult.Kind == DispatcherResultKind.Completed)
            operation();
        return Task.FromResult(LifecycleResult);
    }
}

internal sealed class FakeTransactionCleanup : IAgentTransactionCleanup
{
    public List<string>? Calls { get; set; }
    public int Count { get; private set; }

    public void CleanupOpenTransactions()
    {
        Count++;
        Calls?.Add("transactions.cleanup");
    }
}

internal sealed class FakeInstanceIdSource : ILifecycleInstanceIdSource
{
    private int _next;

    public string Create() => $"instance-{++_next}";
}
