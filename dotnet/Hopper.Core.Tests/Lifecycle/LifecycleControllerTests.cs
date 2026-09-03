using Hopper.Core.Dispatching;
using Hopper.Core.Lifecycle;
using Xunit;

namespace Hopper.Core.Tests.Lifecycle;

public sealed class LifecycleControllerTests
{
    [Fact]
    public async Task StartBecomesRunningOnlyAfterAuthenticatedHandshake()
    {
        var fixture = new LifecycleFixture();
        fixture.Transport.HandshakeGate = NewGate<LifecycleActionResult>();

        var start = fixture.Controller.StartAsync();

        Assert.Equal(LifecycleState.Starting, fixture.Controller.Snapshot.State);
        Assert.False(start.IsCompleted);
        Assert.Equal(TimeSpan.FromSeconds(60), fixture.Transport.HandshakeTimeout);

        fixture.Transport.HandshakeGate.SetResult(LifecycleActionResult.Success());
        var result = await start;

        Assert.True(result.Accepted);
        Assert.Equal(LifecycleState.Running, result.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.Started, result.Snapshot.Reason);
        Assert.Equal(
            [
                "dispatcher.close", "dispatcher.cancel", "node.resolve",
                "transport.start", "profile.write", "child.start",
                "transport.handshake", "dispatcher.reopen",
            ],
            fixture.Calls);
    }

    [Fact]
    public async Task StopDuringBlockedHandshakeIsAcceptedBeforeHandshakeCompletes()
    {
        var fixture = new LifecycleFixture();
        fixture.Transport.HandshakeGate = NewGate<LifecycleActionResult>();
        fixture.Transport.StopGate = NewGate<bool>();
        var start = fixture.Controller.StartAsync();
        Assert.Equal(LifecycleState.Starting, fixture.Controller.Snapshot.State);

        var request = fixture.Controller.RequestStop();

        Assert.True(request.Accepted);
        Assert.Equal(LifecycleState.Stopping, request.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.StopRequested, request.Snapshot.Reason);
        Assert.False(fixture.Transport.HandshakeGate.Task.IsCompleted);
        Assert.Equal(1, fixture.Transport.StartCount);
        Assert.Equal(1, fixture.Child.StartCount);

        var stopped = fixture.Controller.StopAsync();
        var restarted = fixture.Controller.RestartAsync();
        var cancelledStart = await start;

        Assert.True(cancelledStart.Accepted);
        Assert.Equal(1, fixture.Transport.StartCount);
        Assert.Equal(1, fixture.Child.StartCount);
        Assert.False(fixture.Transport.HandshakeGate.Task.IsCompleted);

        fixture.Transport.HandshakeGate = null;
        fixture.Transport.StopGate.SetResult(true);
        Assert.Equal(LifecycleState.Stopped, (await stopped).Snapshot.State);
        Assert.Equal(LifecycleState.Running, (await restarted).Snapshot.State);
        Assert.NotEqual(LifecycleState.Faulted, fixture.Controller.Snapshot.State);
        Assert.Equal(2, fixture.Transport.StartCount);
        Assert.Equal(2, fixture.Child.StartCount);
    }

    [Fact]
    public async Task ConcurrentStartsCreateOnlyOneRuntime()
    {
        var fixture = new LifecycleFixture();
        fixture.Transport.HandshakeGate = NewGate<LifecycleActionResult>();

        var first = fixture.Controller.StartAsync();
        var second = fixture.Controller.StartAsync();
        fixture.Transport.HandshakeGate.SetResult(LifecycleActionResult.Success());

        Assert.True((await first).Accepted);
        Assert.False((await second).Accepted);
        Assert.Equal(1, fixture.Node.ResolveCount);
        Assert.Equal(1, fixture.Transport.StartCount);
        Assert.Equal(1, fixture.Child.StartCount);
    }

    [Fact]
    public async Task FailedHandshakeUnwindsOnlyResourcesCreatedByAttempt()
    {
        var fixture = new LifecycleFixture();
        fixture.Transport.HandshakeResult = LifecycleActionResult.Failure("bad token");

        var result = await fixture.Controller.StartAsync();

        Assert.Equal(LifecycleState.Faulted, result.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.HandshakeFailed, result.Snapshot.Reason);
        Assert.Equal(
            [
                "dispatcher.close", "dispatcher.cancel", "node.resolve",
                "transport.start", "profile.write", "child.start",
                "transport.handshake", "child.kill", "child.wait",
                "transport.stop", "profile.delete",
            ],
            fixture.Calls);
    }

    [Fact]
    public async Task FailedProfileWithoutCreatedFileDoesNotDeleteOrStartChild()
    {
        var fixture = new LifecycleFixture();
        fixture.Profiles.WriteResult = new(false, false, null, "disk full");

        var result = await fixture.Controller.StartAsync();

        Assert.Equal(LifecycleReasonCode.ProfileWriteFailed, result.Snapshot.Reason);
        Assert.Equal(0, fixture.Profiles.DeleteCount);
        Assert.Equal(0, fixture.Child.StartCount);
        Assert.Equal(1, fixture.Transport.StopCount);
    }

    [Fact]
    public async Task StopUsesLifecycleControlThenOrderedDeadlineBoundCleanup()
    {
        var fixture = await StartFixtureAsync();
        fixture.Calls.Clear();

        var result = await fixture.Controller.StopAsync();

        Assert.Equal(LifecycleState.Stopped, result.Snapshot.State);
        Assert.Equal(TimeSpan.FromSeconds(3), fixture.Child.GracefulTimeout);
        Assert.Equal(TimeSpan.FromSeconds(2), fixture.Transport.StopTimeout);
        Assert.Equal(
            [
                "dispatcher.close", "dispatcher.cancel", "dispatcher.lifecycle",
                "transactions.cleanup", "child.graceful-stop", "transport.stop",
                "profile.delete",
            ],
            fixture.Calls);
    }

    [Fact]
    public async Task ChildThatSurvivesVerifiedKillFaultsAndPreservesProfile()
    {
        var fixture = await StartFixtureAsync();
        fixture.Child.GracefulStopResult = false;
        fixture.Child.WaitResult = false;

        var result = await fixture.Controller.StopAsync();

        Assert.Equal(LifecycleState.Faulted, result.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.ChildStillAlive, result.Snapshot.Reason);
        Assert.Equal(TimeSpan.FromSeconds(1), fixture.Child.WaitTimeout);
        Assert.Equal(0, fixture.Profiles.DeleteCount);
        Assert.Equal(0, fixture.Transport.StopCount);
    }

    [Fact]
    public async Task TransportStopTimeoutFaultsBeforeProfileDeletion()
    {
        var fixture = await StartFixtureAsync();
        fixture.Transport.StopResult = false;

        var result = await fixture.Controller.StopAsync();

        Assert.Equal(LifecycleState.Faulted, result.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.TransportStopTimeout, result.Snapshot.Reason);
        Assert.Equal(0, fixture.Profiles.DeleteCount);
    }

    [Fact]
    public async Task RepeatedRestartCoalescesAndDoesNotOverlapReplacement()
    {
        var fixture = await StartFixtureAsync();
        fixture.Transport.StopGate = NewGate<bool>();

        var first = fixture.Controller.RestartAsync();
        var second = fixture.Controller.RestartAsync();

        Assert.Same(first, second);
        Assert.Equal(LifecycleState.Stopping, fixture.Controller.Snapshot.State);
        Assert.Equal(1, fixture.Transport.StartCount);
        Assert.Equal(1, fixture.Child.StartCount);

        fixture.Transport.StopGate.SetResult(true);
        var result = await first;

        Assert.Equal(LifecycleState.Running, result.Snapshot.State);
        Assert.Equal(2, fixture.Transport.StartCount);
        Assert.Equal(2, fixture.Child.StartCount);
    }

    [Fact]
    public async Task PlainStartDuringStoppingIsIgnoredRatherThanQueued()
    {
        var fixture = await StartFixtureAsync();
        fixture.Transport.StopGate = NewGate<bool>();
        var stop = fixture.Controller.StopAsync();
        Assert.Equal(LifecycleState.Stopping, fixture.Controller.Snapshot.State);

        var start = await fixture.Controller.StartAsync();

        Assert.False(start.Accepted);
        Assert.Equal(LifecycleState.Stopping, start.Snapshot.State);
        Assert.Equal(1, fixture.Transport.StartCount);
        fixture.Transport.StopGate.SetResult(true);
        await stop;
        Assert.Equal(1, fixture.Transport.StartCount);
    }

    [Fact]
    public async Task TransactionCleanupStartTimeoutIsTypedAndStillTearsDownResources()
    {
        var fixture = await StartFixtureAsync();
        fixture.Dispatcher.LifecycleResult =
            DispatcherResult<bool>.DeadlineExceededBeforeStart();

        var result = await fixture.Controller.StopAsync();

        Assert.Equal(LifecycleState.Faulted, result.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.TransactionCleanupTimeout, result.Snapshot.Reason);
        Assert.Equal(
            fixture.Clock.UtcNow.AddSeconds(2),
            fixture.Dispatcher.LifecycleDeadline);
        Assert.Equal(1, fixture.Child.GracefulStopCount);
        Assert.Equal(1, fixture.Transport.StopCount);
        Assert.Equal(1, fixture.Profiles.DeleteCount);
    }

    [Fact]
    public async Task HealthThresholdFaultsAfterThreeConsecutiveFailures()
    {
        var fixture = await StartFixtureAsync();

        await fixture.Controller.ReportHealthCheckAsync(false);
        await fixture.Controller.ReportHealthCheckAsync(false);
        Assert.Equal(LifecycleState.Running, fixture.Controller.Snapshot.State);
        Assert.Equal(2, fixture.Controller.Snapshot.ConsecutiveHealthFailures);

        await fixture.Controller.ReportHealthCheckAsync(false);

        Assert.Equal(LifecycleState.Faulted, fixture.Controller.Snapshot.State);
        Assert.Equal(
            LifecycleReasonCode.HealthFailureThresholdReached,
            fixture.Controller.Snapshot.Reason);
    }

    [Fact]
    public async Task HealthyCheckResetsConsecutiveFailures()
    {
        var fixture = await StartFixtureAsync();
        await fixture.Controller.ReportHealthCheckAsync(false);

        await fixture.Controller.ReportHealthCheckAsync(true);

        Assert.Equal(0, fixture.Controller.Snapshot.ConsecutiveHealthFailures);
        Assert.Equal(LifecycleReasonCode.HealthCheckRecovered, fixture.Controller.Snapshot.Reason);
    }

    [Fact]
    public async Task UnexpectedChildExitFaultsAndCleansRemainingResources()
    {
        var fixture = await StartFixtureAsync();

        await fixture.Controller.ReportUnexpectedChildExitAsync();

        Assert.Equal(LifecycleState.Faulted, fixture.Controller.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.UnexpectedChildExit, fixture.Controller.Snapshot.Reason);
        Assert.Contains("unknown outcome", fixture.Controller.Snapshot.Message, StringComparison.Ordinal);
        Assert.Equal(0, fixture.Child.GracefulStopCount);
        Assert.Equal(1, fixture.Transport.StopCount);
        Assert.Equal(1, fixture.Profiles.DeleteCount);
    }

    [Fact]
    public async Task RhinoClosingUsesOnlyNoWaitSignals()
    {
        var fixture = await StartFixtureAsync();
        fixture.Calls.Clear();

        fixture.Controller.CloseForRhinoExit();

        Assert.Equal(LifecycleState.Stopping, fixture.Controller.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.RhinoClosing, fixture.Controller.Snapshot.Reason);
        Assert.Equal(
            [
                "dispatcher.close",
                "dispatcher.cancel",
                "dispatcher.lifecycle",
                "transactions.cleanup",
                "transport.signal",
                "child.kill",
            ],
            fixture.Calls);
        Assert.Equal(1, fixture.Transactions.Count);
        Assert.Equal(0, fixture.Child.GracefulStopCount);
        Assert.Equal(0, fixture.Child.WaitCount);
        Assert.Equal(0, fixture.Transport.StopCount);
    }

    [Fact]
    public async Task SnapshotsAreImmutableRevisionedAndClockStamped()
    {
        var fixture = new LifecycleFixture();
        var initial = fixture.Controller.Snapshot;
        fixture.Clock.Advance(TimeSpan.FromSeconds(5));

        await fixture.Controller.StartAsync();
        var running = fixture.Controller.Snapshot;

        Assert.Equal(0, initial.Revision);
        Assert.Equal(LifecycleState.Stopped, initial.State);
        Assert.Equal(2, running.Revision);
        Assert.Equal(initial.ChangedAt.AddSeconds(5), running.ChangedAt);
        Assert.Equal(LifecycleState.Stopped, initial.State);
    }

    private static async Task<LifecycleFixture> StartFixtureAsync()
    {
        var fixture = new LifecycleFixture();
        var result = await fixture.Controller.StartAsync();
        Assert.Equal(LifecycleState.Running, result.Snapshot.State);
        return fixture;
    }

    private static TaskCompletionSource<T> NewGate<T>() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);
}
