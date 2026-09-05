using Hopper.Core;
using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Core.Time;
using Hopper.Rhino.Host;
using System.Text.Json;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class HopperHostFacadeTests
{
    [Fact]
    public async Task StartWhileRunningReopensBrowserWithoutRestartingHost()
    {
        var fixture = new FacadeFixture();
        fixture.Facade.RequestStart();
        await fixture.FacadeScheduler.RunNext();
        var instanceId = fixture.Controller.Snapshot.LifecycleInstanceId;

        var receipt = fixture.Facade.RequestStart();

        Assert.True(receipt.Accepted);
        Assert.Equal("HopperCode browser reopen requested.", receipt.Message);
        Assert.Equal(0, fixture.BrowserOpenCount);
        await fixture.FacadeScheduler.RunNext();
        Assert.Equal(1, fixture.BrowserOpenCount);
        Assert.Equal(instanceId, fixture.Controller.Snapshot.LifecycleInstanceId);
        Assert.Equal(1, fixture.Transport.StartCount);
        Assert.Equal(1, fixture.RunningObserver.RunningCount);
        Assert.Equal(0, fixture.RunningObserver.ResetCount);
    }

    [Fact]
    public async Task QueuedBrowserReopenIsIgnoredAfterStop()
    {
        var fixture = new FacadeFixture();
        fixture.Facade.RequestStart();
        await fixture.FacadeScheduler.RunNext();
        fixture.Facade.RequestStart();

        fixture.Facade.RequestStop();
        await fixture.FacadeScheduler.RunNext();

        Assert.Equal(0, fixture.BrowserOpenCount);
        await fixture.LifecycleScheduler.RunAll();
        await fixture.FacadeScheduler.RunAll();
    }

    [Fact]
    public void RepeatedStartWhileQueuedDoesNotOpenBrowserOrQueueAnotherStart()
    {
        var fixture = new FacadeFixture();
        fixture.Facade.RequestStart();

        Assert.False(fixture.Facade.RequestStart().Accepted);
        Assert.Single(fixture.FacadeScheduler.Pending);
        Assert.Equal(0, fixture.BrowserOpenCount);
    }

    [Fact]
    public async Task StartIsAcceptedWithoutRunningWorkOnCommandThread()
    {
        var fixture = new FacadeFixture();

        var receipt = fixture.Facade.RequestStart();

        Assert.True(receipt.Accepted);
        Assert.Equal("HopperCode start accepted.", receipt.Message);
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Stopped, fixture.Controller.Snapshot.State);
        Assert.Single(fixture.FacadeScheduler.Pending);

        await fixture.FacadeScheduler.RunNext();
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Running, fixture.Controller.Snapshot.State);
    }

    [Fact]
    public async Task StopCancelsAStartThatHasNotEnteredLifecycleGate()
    {
        var fixture = new FacadeFixture();
        fixture.Facade.RequestStart();

        var stop = fixture.Facade.RequestStop();

        Assert.True(stop.Accepted);
        Assert.Equal("HopperCode queued start cancelled.", stop.Message);
        await fixture.FacadeScheduler.RunNext();
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Stopped, fixture.Controller.Snapshot.State);
        Assert.Equal(0, fixture.Transport.StartCount);
    }

    [Fact]
    public async Task StopAndRestartPublishImmediateIntentThenFinishOffThread()
    {
        var fixture = new FacadeFixture();
        fixture.Facade.RequestStart();
        await fixture.FacadeScheduler.RunNext();

        var stop = fixture.Facade.RequestStop();

        Assert.True(stop.Accepted);
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Stopping, stop.Lifecycle.State);
        Assert.Single(fixture.LifecycleScheduler.Pending);
        await fixture.LifecycleScheduler.RunNext();
        await fixture.FacadeScheduler.RunNext();
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Stopped, fixture.Controller.Snapshot.State);

        fixture.Facade.RequestStart();
        await fixture.FacadeScheduler.RunNext();
        var restart = fixture.Facade.RequestRestart();
        Assert.True(restart.Accepted);
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Stopping, restart.Lifecycle.State);
        await fixture.LifecycleScheduler.RunAll();
        Assert.Equal(Hopper.Core.Lifecycle.LifecycleState.Running, fixture.Controller.Snapshot.State);
        Assert.Equal(3, fixture.Transport.StartCount);
    }

    [Fact]
    public void StatusReadsOnlyTheEventFedCoreSnapshot()
    {
        var fixture = new FacadeFixture();
        fixture.Rhino.TryRegister(new RhinoAdapter());
        fixture.Grasshopper.TryRegister(new GrasshopperAdapter());
        var coordinator = new HostDocumentStatusCoordinator(
            fixture.Status,
            fixture.Grasshopper,
            new Wakeups());
        coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Rhino,
            true,
            "Rhino Model"));
        coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Grasshopper,
            true,
            "Grasshopper Model"));

        var status = fixture.Facade.GetStatus();

        Assert.Equal("Rhino Model", status.RhinoDocument.DocumentName);
        Assert.Equal("Grasshopper Model", status.GrasshopperDocument.DocumentName);
        Assert.Equal(GrasshopperCapabilityState.Ready, status.Grasshopper.State);
    }

    [Fact]
    public void RhinoAssemblyHasNoGrasshopperOrLegacyBackendReference()
    {
        var references = typeof(HopperHostFacade).Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name)
            .ToArray();

        Assert.DoesNotContain("Grasshopper", references);
        Assert.DoesNotContain("Hopper.Backend", references);
    }

    [Fact]
    public void RhinoCloseResetsRunningObserverAndDoesNotScheduleAWait()
    {
        var fixture = new FacadeFixture();

        fixture.Facade.CloseForRhinoExit();

        Assert.Equal(1, fixture.RunningObserver.ResetCount);
        Assert.Empty(fixture.FacadeScheduler.Pending);
        Assert.Equal(LifecycleReasonCode.RhinoClosing, fixture.Controller.Snapshot.Reason);
    }

    [Fact]
    public void InternalGrasshopperStartIsCoalescedAndPublishesLoadingStatus()
    {
        var pluginDirectory = Path.Combine("root", "plugins");
        var expectedAssembly = Path.Combine(
            pluginDirectory,
            GrasshopperInstallationProbe.AssemblyFileName);
        var fixture = new FacadeFixture(GrasshopperInstallationProbe.IsInstalled(
            pluginDirectory,
            path => string.Equals(path, expectedAssembly, StringComparison.Ordinal)));
        var request = Request(RpcOperation.startGrasshopper);

        Assert.Equal(GrasshopperCapabilityState.NotLoaded, fixture.Grasshopper.Status.State);
        var first = fixture.Facade.Execute(request);
        var second = fixture.Facade.Execute(request);

        Assert.Equal(RpcResultClass.completed, first.Class);
        Assert.Equal(StartGrasshopperState.start_requested,
            first.Data?.Deserialize<StartGrasshopperDataV2>(RpcV2Contract.JsonOptions)?.State);
        Assert.Equal(RpcResultClass.completed, second.Class);
        Assert.Equal(1, fixture.GrasshopperStart.CallCount);
        Assert.Equal(GrasshopperCapabilityState.Loading, fixture.Grasshopper.Status.State);
        Assert.Equal(GrasshopperState.loading, fixture.Facade.GetStatus().Runtime.Grasshopper.State);
    }

    [Fact]
    public void MissingPackagedGrasshopperAssemblyRemainsNotInstalled()
    {
        var installed = GrasshopperInstallationProbe.IsInstalled(
            Path.Combine("root", "plugins"),
            _ => false);
        var fixture = new FacadeFixture(installed);

        Assert.Equal(GrasshopperCapabilityState.NotInstalled, fixture.Grasshopper.Status.State);
        Assert.Equal(GrasshopperState.not_installed, fixture.Facade.GetStatus().Runtime.Grasshopper.State);
        var response = fixture.Facade.Execute(Request(RpcOperation.startGrasshopper));

        Assert.Equal(RpcResultClass.capability_unavailable, response.Class);
        Assert.Equal(RpcReasonCode.GRASSHOPPER_NOT_INSTALLED, response.ReasonCode);
        Assert.Equal(GrasshopperCapabilityState.NotInstalled, fixture.Grasshopper.Status.State);
        Assert.Equal(0, fixture.GrasshopperStart.CallCount);
    }

    [Fact]
    public void FailedGrasshopperCommandKeepsInstalledCapability()
    {
        var fixture = new FacadeFixture();
        fixture.GrasshopperStart.Result = false;

        var response = fixture.Facade.Execute(Request(RpcOperation.startGrasshopper));

        Assert.Equal(RpcResultClass.failed, response.Class);
        Assert.Equal(RpcReasonCode.GRASSHOPPER_START_FAILED, response.ReasonCode);
        Assert.Equal(GrasshopperCapabilityState.Failed, fixture.Grasshopper.Status.State);
        Assert.Equal(GrasshopperState.failed, fixture.Facade.GetStatus().Runtime.Grasshopper.State);
    }

    [Fact]
    public void InternalCancellationReturnsTheExactProtocolState()
    {
        var fixture = new FacadeFixture();
        fixture.Cancellation.Next = CancelOperationState.rejected_already_started;

        var response = fixture.Facade.Execute(Request(
            RpcOperation.cancelOperation,
            new OperationReferenceArgsV2 { OperationId = "op-running" }));

        Assert.Equal(RpcResultClass.failed, response.Class);
        Assert.Equal(RpcReasonCode.CANCELLATION_REJECTED_ALREADY_STARTED, response.ReasonCode);
        Assert.Equal("op-running", fixture.Cancellation.LastOperationId);
        Assert.Equal(CancelOperationState.rejected_already_started,
            response.Data?.Deserialize<CancelOperationDataV2>(RpcV2Contract.JsonOptions)?.State);
    }

    private static RpcRequestV2 Request(RpcOperation operation, object? args = null) => new()
    {
        Operation = operation,
        Args = JsonSerializer.SerializeToElement(args ?? new { }, RpcV2Contract.JsonOptions),
    };

    private sealed class FacadeFixture
    {
        public FacadeFixture(bool grasshopperInstalled = true)
        {
            Grasshopper = new GrasshopperCapabilityRegistry(
                SystemHopperClock.Instance,
                installed: grasshopperInstalled);
            Controller = new LifecycleController(
                new NodeProvider(),
                Transport,
                new Profiles(),
                new Child(),
                new Dispatcher(),
                new Transactions(),
                new InstanceIds(),
                LifecycleScheduler,
                SystemHopperClock.Instance);
            Status = new RuntimeStatusStore(
                SystemHopperClock.Instance,
                new DispatcherStatus(true, false, false, 0, 64, 0, 1),
                Grasshopper.Status);
            Facade = new HopperHostFacade(
                Controller,
                FacadeScheduler,
                Rhino,
                Grasshopper,
                Status,
                GrasshopperStart,
                Cancellation,
                RunningObserver,
                reopenBrowser: () => BrowserOpenCount++);
        }

        public QueuedScheduler FacadeScheduler { get; } = new();
        public QueuedScheduler LifecycleScheduler { get; } = new();
        public FakeTransport Transport { get; } = new();
        public RhinoOperationRegistry Rhino { get; } = new();
        public GrasshopperCapabilityRegistry Grasshopper { get; }
        public RuntimeStatusStore Status { get; }
        public GrasshopperStarter GrasshopperStart { get; } = new();
        public OperationCancellation Cancellation { get; } = new();
        public RunningObserver RunningObserver { get; } = new();
        public LifecycleController Controller { get; }
        public HopperHostFacade Facade { get; }
        public int BrowserOpenCount { get; private set; }
    }

    private sealed class Wakeups : IRuntimeStatusWakeupPublisher
    {
        public void PublishStatusChanged(long revision)
        {
        }
    }

    private sealed class RunningObserver : IHopperRunningObserver
    {
        public int ResetCount { get; private set; }
        public int RunningCount { get; private set; }

        public void Reset() => ResetCount++;

        public void OnRunning()
        {
            RunningCount++;
        }
    }

    private sealed class GrasshopperStarter : IGrasshopperStartController
    {
        public int CallCount { get; private set; }
        public bool Result { get; set; } = true;

        public bool StartGrasshopper()
        {
            CallCount++;
            return Result;
        }
    }

    private sealed class OperationCancellation : IHopperOperationCancellation
    {
        public CancelOperationState Next { get; set; } = CancelOperationState.not_found;
        public string? LastOperationId { get; private set; }

        public CancelOperationState Cancel(string operationId)
        {
            LastOperationId = operationId;
            return Next;
        }
    }

    private sealed class QueuedScheduler : ILifecycleBackgroundScheduler
    {
        public Queue<Func<Task>> Pending { get; } = new();

        public Task Schedule(Func<Task> operation)
        {
            Pending.Enqueue(operation);
            return Task.CompletedTask;
        }

        public Task RunNext() => Pending.Dequeue()();

        public async Task RunAll()
        {
            while (Pending.Count > 0)
                await RunNext();
        }
    }

    private sealed class NodeProvider : INodeRuntimeProvider
    {
        public Task<NodeRuntimeResolution> ResolveAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(NodeRuntimeResolution.Success(
                new NodeRuntime("/node", new NodeRuntimeVersion(22, 19, 0), NodeRuntimeSource.StandardPath)));
    }

    private sealed class FakeTransport : ILifecycleTransport
    {
        public bool IsRunning { get; private set; }
        public int StartCount { get; private set; }

        public Task<TransportStartResult> StartAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            StartCount++;
            IsRunning = true;
            return Task.FromResult(new TransportStartResult(
                true,
                true,
                new LifecycleTransportConnection("router", "publisher", "token"),
                ""));
        }

        public Task<LifecycleActionResult> WaitForAuthenticatedHandshakeAsync(
            string lifecycleInstanceId,
            TimeSpan timeout,
            CancellationToken cancellationToken) =>
            Task.FromResult(LifecycleActionResult.Success());

        public Task<bool> StopAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            IsRunning = false;
            return Task.FromResult(true);
        }

        public void SignalStopNoWait() => IsRunning = false;
    }

    private sealed class Profiles : IInstanceProfileStore
    {
        public Task<ProfileWriteResult> WriteAsync(
            string lifecycleInstanceId,
            LifecycleTransportConnection connection,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ProfileWriteResult(true, true, "/profile", ""));

        public Task<LifecycleActionResult> DeleteOwnedAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken) =>
            Task.FromResult(LifecycleActionResult.Success());
    }

    private sealed class Child : IManagedChildProcess
    {
        public bool IsAlive { get; private set; }

        public Task<ChildStartResult> StartAsync(
            NodeRuntime runtime,
            string profilePath,
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            IsAlive = true;
            return Task.FromResult(new ChildStartResult(true, true, ""));
        }

        public Task<bool> RequestGracefulStopAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            IsAlive = false;
            return Task.FromResult(true);
        }

        public void KillVerifiedTreeNoWait() => IsAlive = false;
        public Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
            Task.FromResult(true);
    }

    private sealed class Dispatcher : ILifecycleDispatcher
    {
        public void CloseExternalAdmission()
        {
        }

        public bool ReopenExternalAdmission() => true;
        public int CancelQueuedExternal() => 0;

        public Task<DispatcherResult<bool>> SubmitLifecycleControl(
            Action operation,
            DateTimeOffset? startDeadlineAt = null,
            CancellationToken cancellationToken = default)
        {
            operation();
            return Task.FromResult(DispatcherResult<bool>.Completed(true));
        }
    }

    private sealed class Transactions : IAgentTransactionCleanup
    {
        public void CleanupOpenTransactions()
        {
        }
    }

    private sealed class InstanceIds : ILifecycleInstanceIdSource
    {
        private int _next;
        public string Create() => $"instance-{++_next}";
    }

    private sealed class RhinoAdapter : IRhinoOperationAdapter
    {
        public OperationDocumentStatus DocumentStatus =>
            throw new InvalidOperationException("Status must come from host events.");
        public bool CanExecute(RpcOperation operation) => false;
        public OperationResultV2 Execute(RpcRequestV2 request) => new();
    }

    private sealed class GrasshopperAdapter : IGrasshopperAdapter
    {
        public OperationDocumentStatus DocumentStatus =>
            throw new InvalidOperationException("Status must come from host events.");
        public bool CanExecute(RpcOperation operation) => false;
        public OperationResultV2 Execute(RpcRequestV2 request) => new();
        public void CleanupOpenTransactions()
        {
        }
    }
}
