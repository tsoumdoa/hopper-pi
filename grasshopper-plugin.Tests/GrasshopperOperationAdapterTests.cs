using Hopper.Core.Protocol;
using Xunit;

namespace rhino_zmq_poc.Tests;

public class GrasshopperOperationAdapterTests
{
    [Theory]
    [InlineData(RpcOperation.listAllComponents)]
    [InlineData(RpcOperation.getCurrentCanvas)]
    [InlineData(RpcOperation.applyGraph)]
    [InlineData(RpcOperation.addComponent)]
    [InlineData(RpcOperation.beginAgentTransaction)]
    [InlineData(RpcOperation.setParamRhinoGeometry)]
    public void HandlesGrasshopperOperations(RpcOperation operation)
    {
        var adapter = new GrasshopperOperationAdapter();

        Assert.True(adapter.CanExecute(operation));
    }

    [Theory]
    [InlineData(RpcOperation.getRuntimeStatus)]
    [InlineData(RpcOperation.startGrasshopper)]
    [InlineData(RpcOperation.queryRhinoObjects)]
    [InlineData(RpcOperation.runRhinoScript)]
    [InlineData(RpcOperation.captureRhinoView)]
    [InlineData(RpcOperation.controlRhinoView)]
    [InlineData(RpcOperation.beginRhinoAgentTransaction)]
    public void RejectsHostAndRhinoOperations(RpcOperation operation)
    {
        var adapter = new GrasshopperOperationAdapter();

        Assert.False(adapter.CanExecute(operation));
    }
}
