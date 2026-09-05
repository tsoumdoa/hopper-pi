using System.Collections.Concurrent;
using System.Text.Json;
using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Core.Tests.TestDoubles;
using Xunit;
using DomainLifecycleState = Hopper.Core.Lifecycle.LifecycleState;
using ProtocolLifecycleState = Hopper.Core.Protocol.LifecycleState;

namespace Hopper.Core.Tests.Runtime;

public sealed class RuntimeStatusStoreTests
{
    private static readonly DateTimeOffset InitialTime =
        new(2026, 9, 3, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void InitialSnapshotUsesSharedProtocolDto()
    {
        var store = CreateStore(out _);

        var status = store.Read();

        Assert.Equal(RpcV2Contract.ProtocolVersion, status.ProtocolVersion);
        Assert.Equal(0, status.Revision);
        Assert.Equal(InitialTime.ToUnixTimeMilliseconds(), status.ObservedAt);
        Assert.Equal(ProtocolLifecycleState.stopped, status.Lifecycle.State);
        Assert.False(status.Transport.Ready);
        Assert.Null(status.Transport.LifecycleInstanceId);
        Assert.Equal(ProtocolLifecycleState.stopped, status.Host.State);
        Assert.Null(status.Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, status.Host.Handshake);
        Assert.Equal(GrasshopperState.not_loaded, status.Grasshopper.State);
        Assert.Equal(64, status.Dispatcher.Capacity);
        Assert.All(ComponentErrors(status), Assert.Null);
    }

    [Fact]
    public void ActualChangeIncrementsRevisionOnceAndNoOpDoesNot()
    {
        var store = CreateStore(out var clock);
        var initial = store.Read();

        Assert.False(store.UpdateTransport(false, null));
        Assert.Same(initial, store.Read());

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(store.UpdateTransport(true, "life-status-1"));
        var changed = store.Read();
        Assert.Equal(1, changed.Revision);
        Assert.Equal(clock.UtcNow.ToUnixTimeMilliseconds(), changed.ObservedAt);
        Assert.True(changed.Transport.Ready);
        Assert.Equal("life-status-1", changed.Transport.LifecycleInstanceId);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.False(store.UpdateTransport(true, "life-status-1"));
        Assert.Same(changed, store.Read());
        Assert.Equal(1, store.Read().Revision);
        Assert.Equal(InitialTime.AddSeconds(1).ToUnixTimeMilliseconds(), store.Read().ObservedAt);
    }

    [Fact]
    public void TypedUpdatesReplaceWholeSectionsAtomically()
    {
        var store = CreateStore(out var clock);
        var before = store.Read();
        clock.Advance(TimeSpan.FromSeconds(1));

        Assert.True(store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Running,
            4242,
            "/opt/homebrew/bin/node",
            "22.19.0",
            HandshakeState.live,
            2)));

        var after = store.Read();
        Assert.Equal(1, after.Revision);
        Assert.Equal(ProtocolLifecycleState.running, after.Host.State);
        Assert.Equal(4242, after.Host.ProcessId);
        Assert.Equal("/opt/homebrew/bin/node", after.Host.NodePath);
        Assert.Equal("22.19.0", after.Host.NodeVersion);
        Assert.Equal(HandshakeState.live, after.Host.Handshake);
        Assert.Equal(2, after.Host.HealthFailureCount);
        Assert.Equal(ProtocolLifecycleState.stopped, before.Host.State);
        Assert.Null(before.Host.ProcessId);

        var ignoredOnlyDispatcherChange = new DispatcherStatus(
            true,
            true,
            true,
            0,
            64,
            1,
            1);
        Assert.False(store.UpdateDispatcher(ignoredOnlyDispatcherChange));
        Assert.Equal(1, store.Read().Revision);
    }

    [Fact]
    public void LifecycleAndCapabilityTypesMapToProtocolStatus()
    {
        var store = CreateStore(out var clock);
        clock.Advance(TimeSpan.FromSeconds(1));
        var lifecycle = new LifecycleSnapshot(
            9,
            clock.UtcNow,
            DomainLifecycleState.Faulted,
            LifecycleReasonCode.HandshakeFailed,
            "Node did not complete the handshake.",
            "life-status-1",
            3);

        Assert.True(store.UpdateLifecycle(lifecycle));
        var failed = new GrasshopperCapabilityStatus(
            2,
            clock.UtcNow,
            GrasshopperCapabilityState.Failed,
            new GrasshopperCapabilityError("LOAD_FAILED", "Grasshopper failed to load."));
        Assert.True(store.UpdateGrasshopper(failed, false, null));

        var status = store.Read();
        Assert.Equal(2, status.Revision);
        Assert.Equal(ProtocolLifecycleState.faulted, status.Lifecycle.State);
        Assert.Equal(RpcReasonCode.HANDSHAKE_REJECTED, status.Lifecycle.Reason?.Code);
        Assert.Equal("Node did not complete the handshake.", status.Lifecycle.Reason?.Message);
        Assert.Equal(3, status.Host.HealthFailureCount);
        Assert.Equal(GrasshopperState.failed, status.Grasshopper.State);
        Assert.Equal(RpcReasonCode.GRASSHOPPER_START_FAILED, status.Errors.Grasshopper?.Code);
    }

    [Fact]
    public void LifecycleStateTracksHostAndOnlyProvenExitClearsLiveProcessIdentity()
    {
        var store = CreateStore(out var clock);
        store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Running,
            4242,
            "/opt/homebrew/bin/node",
            "22.19.0",
            HandshakeState.live,
            0));
        clock.Advance(TimeSpan.FromSeconds(1));

        store.UpdateLifecycle(new LifecycleSnapshot(
            1,
            clock.UtcNow,
            DomainLifecycleState.Stopping,
            LifecycleReasonCode.StopRequested,
            "Stopping.",
            "life-status-1",
            0));

        Assert.Equal(ProtocolLifecycleState.stopping, store.Read().Host.State);
        Assert.Equal(4242, store.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.live, store.Read().Host.Handshake);

        store.UpdateHostProcessExited();
        store.UpdateLifecycle(new LifecycleSnapshot(
            2,
            clock.UtcNow,
            DomainLifecycleState.Faulted,
            LifecycleReasonCode.UnexpectedChildExit,
            "Exited.",
            "life-status-1",
            0));

        Assert.Equal(ProtocolLifecycleState.faulted, store.Read().Host.State);
        Assert.Null(store.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, store.Read().Host.Handshake);
        Assert.Equal("/opt/homebrew/bin/node", store.Read().Host.NodePath);
        Assert.Equal("22.19.0", store.Read().Host.NodeVersion);
    }

    [Fact]
    public void StoppedLifecycleUnconditionallyClearsProcessIdentityButRetainsNodeDiagnostics()
    {
        var store = CreateStore(out var clock);
        store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Running,
            4242,
            "/opt/homebrew/bin/node",
            "22.19.0",
            HandshakeState.live,
            0));

        store.UpdateLifecycle(new LifecycleSnapshot(
            1,
            clock.UtcNow,
            DomainLifecycleState.Stopped,
            LifecycleReasonCode.Stopped,
            "Stopped.",
            null,
            0));

        Assert.Equal(ProtocolLifecycleState.stopped, store.Read().Host.State);
        Assert.Null(store.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, store.Read().Host.Handshake);
        Assert.Equal("/opt/homebrew/bin/node", store.Read().Host.NodePath);
        Assert.Equal("22.19.0", store.Read().Host.NodeVersion);
    }

    [Fact]
    public void InitialHostHandshakeUsesTheManagedHostIdentityWhileLifecycleMirrorLags()
    {
        var store = CreateStore(out _);
        store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Starting,
            4242,
            "/opt/homebrew/bin/node",
            "22.22.3",
            HandshakeState.connecting,
            0));
        Assert.Equal(ProtocolLifecycleState.stopped, store.Read().Lifecycle.State);

        var before = store.Read();
        var rejected = store.TryAcceptInitialHostHandshake(9999, "v99.0.0");

        Assert.False(rejected.Accepted);
        Assert.Equal(before.Revision, rejected.StatusRevision);
        Assert.Same(before, store.Read());

        var accepted = store.TryAcceptInitialHostHandshake(4242, "v22.22.3");

        Assert.True(accepted.Accepted);
        Assert.Equal(before.Revision + 1, accepted.StatusRevision);
        Assert.Equal(4242, store.Read().Host.ProcessId);
        Assert.Equal("v22.22.3", store.Read().Host.NodeVersion);
        Assert.Equal(HandshakeState.live, store.Read().Host.Handshake);
    }

    [Theory]
    [InlineData(DomainLifecycleState.Stopped)]
    [InlineData(DomainLifecycleState.Running)]
    [InlineData(DomainLifecycleState.Stopping)]
    [InlineData(DomainLifecycleState.Faulted)]
    public void InitialHostHandshakeRejectsAnyManagedHostStateExceptStarting(
        DomainLifecycleState hostState)
    {
        var store = CreateStore(out _);
        store.UpdateHost(new HostRuntimeStatusUpdate(
            hostState,
            4242,
            "/opt/homebrew/bin/node",
            "22.22.3",
            HandshakeState.connecting,
            0));
        var before = store.Read();

        var rejected = store.TryAcceptInitialHostHandshake(4242, "v22.22.3");

        Assert.False(rejected.Accepted);
        Assert.Equal(before.Revision, rejected.StatusRevision);
        Assert.Same(before, store.Read());
    }

    [Fact]
    public void LiveHandshakeAllowsStandaloneClientsWithoutOverwritingManagedIdentity()
    {
        var store = CreateStore(out _);
        store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Running,
            4242,
            "/opt/homebrew/bin/node",
            "v22.22.3",
            HandshakeState.live,
            0));
        var before = store.Read();

        var accepted = store.TryAcceptInitialHostHandshake(9999, "v99.0.0");

        Assert.True(accepted.Accepted);
        Assert.Equal(before.Revision, accepted.StatusRevision);
        Assert.Same(before, store.Read());
    }

    [Fact]
    public void ProcessExitWinsAgainstAStaleInitialHandshake()
    {
        var store = CreateStore(out var clock);
        store.UpdateLifecycle(new LifecycleSnapshot(
            1,
            clock.UtcNow,
            DomainLifecycleState.Starting,
            LifecycleReasonCode.StartRequested,
            "Starting.",
            "life-status-1",
            0));
        store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Starting,
            4242,
            "/opt/homebrew/bin/node",
            "22.22.3",
            HandshakeState.connecting,
            0));
        store.UpdateHostProcessExited();
        var exited = store.Read();

        var rejected = store.TryAcceptInitialHostHandshake(4242, "v22.22.3");

        Assert.False(rejected.Accepted);
        Assert.Equal(exited.Revision, rejected.StatusRevision);
        Assert.Same(exited, store.Read());
        Assert.Null(store.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, store.Read().Host.Handshake);
    }

    [Fact]
    public void ComponentErrorsAndDocumentsRejectInconsistentInput()
    {
        var store = CreateStore(out _);
        foreach (var component in Enum.GetValues<RuntimeStatusComponent>())
        {
            Assert.True(store.UpdateError(component, new RuntimeErrorV2
            {
                Code = RpcReasonCode.INTERNAL_ERROR,
                Message = $"{component} failed.",
            }));
        }

        Assert.False(store.UpdateError(RuntimeStatusComponent.Transport, new RuntimeErrorV2
        {
            Code = RpcReasonCode.INTERNAL_ERROR,
            Message = "Transport failed.",
        }));
        Assert.All(ComponentErrors(store.Read()), Assert.NotNull);
        Assert.Throws<ArgumentException>(() => store.UpdateTransport(true, null));
        Assert.Throws<ArgumentException>(() => store.UpdateRhinoDocument(false, "Stale.3dm"));
        Assert.Throws<ArgumentException>(() => store.UpdateGrasshopper(
            new GrasshopperCapabilityStatus(0, InitialTime, GrasshopperCapabilityState.Loading, null),
            true,
            "Stale.gh"));
        Assert.Throws<ArgumentOutOfRangeException>(() => store.UpdateHost(new HostRuntimeStatusUpdate(
            DomainLifecycleState.Running,
            0,
            null,
            null,
            HandshakeState.live,
            0)));
        Assert.Equal(5, store.Read().Revision);
    }

    [Fact]
    public async Task ConcurrentReadersSeeCompleteImmutableSnapshots()
    {
        var store = CreateStore(out _);
        using var start = new ManualResetEventSlim(false);
        var readCount = 0;
        var failures = new ConcurrentQueue<Exception>();
        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
        {
            start.Wait();
            try
            {
                while (true)
                {
                    var snapshot = store.Read();
                    Assert.Equal(RpcV2Contract.ProtocolVersion, snapshot.ProtocolVersion);
                    Assert.Equal(snapshot.Revision % 2 == 1, snapshot.Rhino.ActiveDocument);
                    if (snapshot.Rhino.ActiveDocument)
                        Assert.StartsWith("Document-", snapshot.Rhino.DocumentName);
                    else
                        Assert.Null(snapshot.Rhino.DocumentName);
                    Interlocked.Increment(ref readCount);
                    if (snapshot.Revision == 2_000)
                        return;
                }
            }
            catch (Exception exception)
            {
                failures.Enqueue(exception);
            }
        })).ToArray();

        start.Set();
        for (var revision = 1; revision <= 2_000; revision++)
        {
            var active = revision % 2 == 1;
            Assert.True(store.UpdateRhinoDocument(
                active,
                active ? $"Document-{revision}.3dm" : null));
        }
        await Task.WhenAll(readers);

        Assert.Empty(failures);
        Assert.True(readCount > 0);
        Assert.Equal(2_000, store.Read().Revision);
    }

    [Fact]
    public void StatusSerializesAsExactSharedGetRuntimeStatusData()
    {
        var store = CreateStore(out _);
        Assert.True(store.UpdateTransport(true, "life-status-1"));
        Assert.True(store.UpdateRhinoDocument(true, "Tower.3dm"));
        Assert.True(store.UpdateGrasshopper(
            new GrasshopperCapabilityStatus(
                1,
                InitialTime,
                GrasshopperCapabilityState.Ready,
                null),
            true,
            "Definition.gh"));
        Assert.True(store.UpdateDispatcher(new DispatcherStatus(
            false,
            false,
            true,
            5,
            12,
            0,
            1)));

        var response = new OperationResponseV2
        {
            ProtocolVersion = RpcV2Contract.ProtocolVersion,
            LifecycleInstanceId = "life-status-1",
            RequestId = "req-status-map",
            Operation = RpcOperation.getRuntimeStatus,
            Result = new OperationResultV2
            {
                Class = RpcResultClass.completed,
                ReasonCode = RpcReasonCode.OK,
                Data = JsonSerializer.SerializeToElement(store.Read(), RpcV2Contract.JsonOptions),
            },
        };

        var json = RpcV2Contract.SerializeResponse(response);
        var parsed = RpcV2Contract.ParseResponse(json);
        Assert.True(parsed.IsValid, string.Join("; ", parsed.Errors));
        var mapped = Assert.IsType<OperationResponseV2>(parsed.Value)
            .Result.Data?.Deserialize<RuntimeStatusV2>(RpcV2Contract.JsonOptions);
        Assert.Equal(store.Read(), mapped);
        Assert.False(mapped?.Dispatcher.AcceptingExternalWork);
        Assert.Equal(5, mapped?.Dispatcher.Depth);
        Assert.Equal(12, mapped?.Dispatcher.Capacity);
    }

    private static RuntimeStatusStore CreateStore(out ManualClock clock)
    {
        clock = new ManualClock(InitialTime);
        return new RuntimeStatusStore(
            clock,
            new DispatcherStatus(
                true,
                false,
                false,
                0,
                64,
                0,
                1),
            new GrasshopperCapabilityStatus(
                0,
                InitialTime,
                GrasshopperCapabilityState.NotLoaded,
                null));
    }

    private static RuntimeErrorV2?[] ComponentErrors(RuntimeStatusV2 status) =>
        new[]
        {
            status.Errors.Transport,
            status.Errors.Host,
            status.Errors.Rhino,
            status.Errors.Grasshopper,
            status.Errors.Dispatcher,
        };
}
