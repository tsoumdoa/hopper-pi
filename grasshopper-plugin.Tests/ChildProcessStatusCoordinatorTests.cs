using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Core.Time;
using Hopper.Rhino.Host;
using Xunit;
using DomainLifecycleState = Hopper.Core.Lifecycle.LifecycleState;

namespace rhino_zmq_poc.Tests;

public sealed class ChildProcessStatusCoordinatorTests
{
    [Fact]
    public void ImmediateExitBeforeStartedStatusCannotRestoreDeadPid()
    {
        var status = CreateStatus();
        var coordinator = new ChildProcessStatusCoordinator(status);
        coordinator.MarkExited();

        coordinator.MarkStarted(Started(), () => true);

        Assert.Null(status.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, status.Read().Host.Handshake);
        Assert.Equal("/node", status.Read().Host.NodePath);
        Assert.Equal("22.19.0", status.Read().Host.NodeVersion);
    }

    [Fact]
    public void ExitAfterStartedStatusClearsPidAndHandshake()
    {
        var status = CreateStatus();
        var coordinator = new ChildProcessStatusCoordinator(status);
        coordinator.MarkStarted(Started(), () => false);

        coordinator.MarkExited();

        Assert.Null(status.Read().Host.ProcessId);
        Assert.Equal(HandshakeState.disconnected, status.Read().Host.Handshake);
    }

    private static RuntimeStatusStore CreateStatus() => new(
        SystemHopperClock.Instance,
        new DispatcherStatus(true, false, false, 0, 64, 0, 1),
        new GrasshopperCapabilityStatus(
            0,
            DateTimeOffset.UtcNow,
            GrasshopperCapabilityState.NotLoaded,
            null));

    private static HostRuntimeStatusUpdate Started() => new(
        DomainLifecycleState.Starting,
        4242,
        "/node",
        "22.19.0",
        HandshakeState.connecting,
        0);
}
