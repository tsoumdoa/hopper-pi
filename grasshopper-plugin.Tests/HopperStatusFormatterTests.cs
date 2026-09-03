using Hopper.Core.Protocol;
using Hopper.Rhino.Host;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class HopperStatusFormatterTests
{
    [Fact]
    public void IncludesEveryRequiredStatusAreaAndErrors()
    {
        var status = new RuntimeStatusV2
        {
            Lifecycle = new LifecycleStatusV2
            {
                State = LifecycleState.faulted,
                Reason = Error(RpcReasonCode.OPERATION_FAILED, "cleanup failed"),
            },
            Host = new HostStatusV2
            {
                State = LifecycleState.faulted,
                ProcessId = 123,
                NodePath = "/usr/local/bin/node",
                NodeVersion = "22.19.0",
                Handshake = HandshakeState.disconnected,
                HealthFailureCount = 3,
            },
            Transport = new TransportStatusV2
            {
                Ready = false,
                LifecycleInstanceId = "instance-1",
            },
            Rhino = new DocumentStatusV2
            {
                ActiveDocument = true,
                DocumentName = "model.3dm",
            },
            Grasshopper = new GrasshopperStatusV2
            {
                State = GrasshopperState.ready,
                ActiveDocument = true,
                DocumentName = "definition.gh",
            },
            Dispatcher = new DispatcherStatusV2
            {
                AcceptingExternalWork = false,
                Depth = 2,
                Capacity = 64,
            },
            Errors = new ComponentErrorsV2
            {
                Host = Error(RpcReasonCode.INTERNAL_ERROR, "health failed"),
                Dispatcher = Error(RpcReasonCode.DISPATCHER_BUSY, "queue full"),
            },
        };

        var lines = HopperStatusFormatter.Format(status);

        Assert.Contains(lines, line => line.Contains("lifecycle: faulted", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Host: faulted; PID: 123", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Transport: stopped; lifecycle instance: instance-1", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Rhino document: model.3dm", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Grasshopper: ready; document: definition.gh", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Dispatcher: closed; depth: 2/64", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("path=/usr/local/bin/node; version=22.19.0", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("host=INTERNAL_ERROR: health failed", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("dispatcher=DISPATCHER_BUSY: queue full", StringComparison.Ordinal));
    }

    private static RuntimeErrorV2 Error(RpcReasonCode code, string message) => new()
    {
        Code = code,
        Message = message,
    };
}
