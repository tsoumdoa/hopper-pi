using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Rhino.Host;
using Xunit;
using LifecycleState = Hopper.Core.Lifecycle.LifecycleState;

namespace Hopper.Core.Tests.Lifecycle;

public sealed class HopperCommandTests
{
    [Fact]
    public async Task StatusShowsServerAddressWithoutBrowserCredentialOrStaleAttachment()
    {
        var fixture = new LifecycleFixture(new ImmediateScheduler());
        var scheduler = new QueuedScheduler();
        var facade = CreateFacade(fixture, scheduler, new Observer(), getBrowserUri:
            () => new Uri("http://127.0.0.1:43123/?instance=rhino-1&starting=1#test-secret"));

        Assert.Null(facade.GetStatus().WebUiAddress);
        facade.RequestStart();
        await scheduler.DrainAsync();
        Assert.Equal("http://127.0.0.1:43123/", facade.GetStatus().WebUiAddress?.AbsoluteUri);

        facade.RequestStop();
        await scheduler.DrainAsync();
        Assert.Null(facade.GetStatus().WebUiAddress);
    }

    [Fact]
    public async Task StartConnectsThenReopensWithoutStartingAnotherAttachment()
    {
        var fixture = new LifecycleFixture(new ImmediateScheduler());
        var scheduler = new QueuedScheduler();
        var observer = new Observer();
        var reopened = 0;
        var facade = CreateFacade(fixture, scheduler, observer, () => reopened++);

        Assert.True(facade.RequestStart().Accepted);
        await scheduler.DrainAsync();
        Assert.Equal(LifecycleState.Running, facade.GetStatus().Lifecycle.State);
        Assert.Equal(1, observer.RunningCount);

        Assert.True(facade.RequestStart().Accepted);
        await scheduler.DrainAsync();
        Assert.Equal(1, reopened);
        Assert.Equal(1, fixture.Child.StartCount);

        Assert.True(facade.RequestStop().Accepted);
        await scheduler.DrainAsync();
        Assert.Equal(LifecycleState.Stopped, facade.GetStatus().Lifecycle.State);
        Assert.False(facade.RequestStop().Accepted);
        Assert.Equal(1, fixture.Child.GracefulStopCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DelayedRestartNotificationDoesNotRestartAgain(bool initiallyRunning)
    {
        var fixture = new LifecycleFixture(new ImmediateScheduler());
        if (initiallyRunning) await fixture.Controller.StartAsync();
        var scheduler = new QueuedScheduler();
        var observer = new Observer();
        var facade = CreateFacade(fixture, scheduler, observer);

        var receipt = facade.RequestRestart();
        var instance = fixture.Controller.Snapshot.LifecycleInstanceId;
        Assert.True(receipt.Accepted);
        Assert.Equal(LifecycleState.Running, fixture.Controller.Snapshot.State);

        await scheduler.DrainAsync();

        Assert.Equal(initiallyRunning ? 2 : 1, fixture.Child.StartCount);
        Assert.Equal(instance, fixture.Controller.Snapshot.LifecycleInstanceId);
        Assert.Equal(1, observer.RunningCount);
    }

    [Fact]
    public async Task RestartReportsCleanupFailureWithoutStartingReplacement()
    {
        var fixture = new LifecycleFixture(new ImmediateScheduler());
        await fixture.Controller.StartAsync();
        fixture.Transport.StopResult = false;
        var scheduler = new QueuedScheduler();
        var observer = new Observer();
        var facade = CreateFacade(fixture, scheduler, observer);

        facade.RequestRestart();
        await scheduler.DrainAsync();

        Assert.Equal(LifecycleState.Faulted, facade.GetStatus().Lifecycle.State);
        Assert.Equal(1, fixture.Child.StartCount);
        Assert.Equal(0, observer.RunningCount);
        Assert.Single(observer.Messages);
    }

    [Fact]
    public async Task StopCancelsQueuedStart()
    {
        var fixture = new LifecycleFixture(new ImmediateScheduler());
        var scheduler = new QueuedScheduler();
        var facade = CreateFacade(fixture, scheduler, new Observer());

        Assert.True(facade.RequestStart().Accepted);
        Assert.True(facade.RequestStop().Accepted);
        await scheduler.DrainAsync();

        Assert.Equal(0, fixture.Child.StartCount);
        Assert.Equal(LifecycleState.Stopped, facade.GetStatus().Lifecycle.State);
    }

    private static HopperHostFacade CreateFacade(
        LifecycleFixture fixture, QueuedScheduler scheduler, Observer observer, Action? reopen = null,
        Func<Uri?>? getBrowserUri = null)
    {
        var grasshopper = new GrasshopperCapabilityRegistry(fixture.Clock, installed: true);
        var status = new RuntimeStatusStore(fixture.Clock,
            new DispatcherStatus(false, false, false, 0, 64, 0, 8), grasshopper.Status);
        return new HopperHostFacade(fixture.Controller, scheduler, new RhinoOperationRegistry(),
            grasshopper, status, observer, observer, observer, observer, reopen, getBrowserUri);
    }

    private sealed class ImmediateScheduler : ILifecycleBackgroundScheduler
    {
        public Task Schedule(Func<Task> operation) => operation();
    }

    private sealed class QueuedScheduler : ILifecycleBackgroundScheduler
    {
        private readonly Queue<Func<Task>> _pending = new();
        public Task Schedule(Func<Task> operation)
        {
            _pending.Enqueue(operation);
            return Task.CompletedTask;
        }
        public async Task DrainAsync()
        {
            while (_pending.TryDequeue(out var operation)) await operation();
        }
    }

    private sealed class Observer : IHopperRunningObserver, IHopperCommandCompletionSink,
        IGrasshopperStartController, IHopperOperationCancellation
    {
        public int RunningCount { get; private set; }
        public List<string> Messages { get; } = new();
        public void Reset() { }
        public void OnRunning() => RunningCount++;
        public void Write(string message) => Messages.Add(message);
        public bool StartGrasshopper() => false;
        public CancelOperationState Cancel(string operationId) => CancelOperationState.not_found;
    }
}
