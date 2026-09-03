using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public class CommandActionRegistryTests
{
    [Fact]
    public void KnownActions_matches_registry_handler_count()
    {
        Assert.Equal(42, CommandActionRegistry.KnownActions.Count);
    }

    [Theory]
    [InlineData("addComponent")]
    [InlineData("setParamRhinoGeometry")]
    public void KnownActions_includes_expected_actions(string action)
    {
        Assert.Contains(action, CommandActionRegistry.KnownActions);
    }
}
