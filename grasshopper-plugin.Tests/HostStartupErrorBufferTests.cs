using Hopper.Rhino.Host;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class HostStartupErrorBufferTests
{
    [Fact]
    public void PreservesTheStartupFailureAndFollowingStackLines()
    {
        var buffer = new HostStartupErrorBuffer();

        buffer.Append("[hopper-host] startup failed: RpcOperationError: Managed PID is not registered yet");
        var message = buffer.Append("    at RuntimeRpc.completeInitialHandshake (runtime-rpc.js:1:1)");

        Assert.StartsWith("[hopper-host] startup failed: RpcOperationError", message);
        Assert.Contains(Environment.NewLine, message);
        Assert.EndsWith("(runtime-rpc.js:1:1)", message);
    }

    [Fact]
    public void BoundsDiagnosticsWhileKeepingTheFirstFailure()
    {
        var buffer = new HostStartupErrorBuffer();
        buffer.Append("first failure");

        var message = buffer.Append(new string('x', HostStartupErrorBuffer.MaximumLength * 2));

        Assert.Equal(HostStartupErrorBuffer.MaximumLength, message.Length);
        Assert.StartsWith("first failure", message);

        buffer.Reset();
        Assert.Equal("fresh failure", buffer.Append("fresh failure"));
    }
}
