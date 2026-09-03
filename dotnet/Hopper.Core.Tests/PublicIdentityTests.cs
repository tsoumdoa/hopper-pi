using Hopper.Core;
using Xunit;

namespace Hopper.Core.Tests;

public class PublicIdentityTests
{
    public static TheoryData<string, string> FrozenCommandIdentities => new()
    {
        { PublicIdentity.HopperCodeCommandName, PublicIdentity.HopperCodeCommandId },
        { PublicIdentity.HopperCodeStopCommandName, PublicIdentity.HopperCodeStopCommandId },
        { PublicIdentity.HopperCodeStatusCommandName, PublicIdentity.HopperCodeStatusCommandId },
        { PublicIdentity.HopperCodeRestartCommandName, PublicIdentity.HopperCodeRestartCommandId },
    };

    [Theory]
    [MemberData(nameof(FrozenCommandIdentities))]
    public void CommandIdentitiesHaveExpectedValues(string name, string id)
    {
        var expected = name switch
        {
            "HopperCode" => "f4e34020-8f9a-4cc4-98ed-5b3596163859",
            "HopperCodeStop" => "c26698e7-9893-4960-b158-f973cac41744",
            "HopperCodeStatus" => "db50ad24-52d8-4e58-ae8a-5719994ad577",
            "HopperCodeRestart" => "af29e70b-389e-4430-bdda-ac40c33d0ab5",
            _ => throw new ArgumentOutOfRangeException(nameof(name), name, null),
        };

        Assert.Equal(expected, id);
    }

    [Fact]
    public void ExistingPluginAndGrasshopperIdentitiesHaveExpectedValues()
    {
        Assert.Equal("4c3eae5e-7e91-4d5c-9bbf-d95e981c5de9", PublicIdentity.RhinoPluginId);
        Assert.Equal("e07753b1-fdec-417a-b57a-83a95204a8dd", PublicIdentity.LegacyGrasshopperComponentId);
        Assert.Equal("a41e7f39-12f0-4cc2-9f84-fd3d6bf3eaef", PublicIdentity.GrasshopperAssemblyId);
    }

    [Fact]
    public void FrozenGuidsAreValidAndUnique()
    {
        var values = new[]
        {
            PublicIdentity.HopperCodeCommandId,
            PublicIdentity.HopperCodeStopCommandId,
            PublicIdentity.HopperCodeStatusCommandId,
            PublicIdentity.HopperCodeRestartCommandId,
            PublicIdentity.RhinoPluginId,
            PublicIdentity.LegacyGrasshopperComponentId,
            PublicIdentity.GrasshopperAssemblyId,
        };

        Assert.All(values, value => Assert.True(Guid.TryParseExact(value, "D", out _)));
        Assert.Equal(values.Length, values.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }
}
