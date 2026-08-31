using rhino_zmq_poc;
using Xunit;

namespace rhino_zmq_poc.Tests;

public class ConnectionProfileTests
{
    [Fact]
    public void InstanceProfilePathIsSeparateFromLegacyPointer()
    {
        var path = ConnectionProfileStore.CreateInstanceProfilePath("abc123");

        Assert.NotEqual(ConnectionProfileStore.ProfilePath, path);
        Assert.EndsWith("abc123.json", path);
        Assert.Contains("instances", path);
    }

    [Fact]
    public void DifferentInstancesReceiveDifferentProfilePaths()
    {
        var first = ConnectionProfileStore.CreateInstanceProfilePath("first");
        var second = ConnectionProfileStore.CreateInstanceProfilePath("second");

        Assert.NotEqual(first, second);
    }
}
