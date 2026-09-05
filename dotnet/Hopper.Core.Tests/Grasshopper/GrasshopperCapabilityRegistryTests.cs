using Hopper.Core.Grasshopper;
using Hopper.Core.Protocol;
using Hopper.Core.Operations;
using Hopper.Core.Tests.TestDoubles;
using Xunit;

namespace Hopper.Core.Tests.Grasshopper;

public class GrasshopperCapabilityRegistryTests
{
    private static readonly DateTimeOffset InitialTime =
        new(2026, 2, 3, 4, 5, 6, TimeSpan.Zero);

    [Fact]
    public void StatusMovesThroughAllCapabilityStatesWithImmutableSnapshots()
    {
        var clock = new ManualClock(InitialTime);
        var registry = new GrasshopperCapabilityRegistry(clock, installed: false);
        var notInstalled = registry.Status;

        Assert.Equal(GrasshopperCapabilityState.NotInstalled, notInstalled.State);
        Assert.Equal("not_installed", notInstalled.StateName);
        Assert.Equal(0, notInstalled.Revision);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(registry.SetInstalled(true));
        var notLoaded = registry.Status;
        Assert.Equal(GrasshopperCapabilityState.NotLoaded, notLoaded.State);
        Assert.Equal("not_loaded", notLoaded.StateName);
        Assert.Equal(1, notLoaded.Revision);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(registry.MarkLoading());
        Assert.Equal("loading", registry.Status.StateName);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(registry.MarkFailed("GH_LOAD_FAILED", "Grasshopper did not load."));
        var failed = registry.Status;
        Assert.Equal("failed", failed.StateName);
        Assert.Equal("GH_LOAD_FAILED", failed.Error?.Code);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(registry.MarkLoading());
        var adapter = new TestAdapter();
        Assert.True(registry.TryRegister(adapter));
        var ready = registry.Status;
        Assert.Equal("ready", ready.StateName);
        Assert.Null(ready.Error);
        Assert.Equal(clock.UtcNow, ready.ChangedAt);

        Assert.Equal("not_installed", notInstalled.StateName);
        Assert.Equal(InitialTime, notInstalled.ChangedAt);
        Assert.Equal(0, notInstalled.Revision);
    }

    [Fact]
    public void RegistrationIsCompareAndSetAndOnlySameInstanceCanUnregister()
    {
        var registry = new GrasshopperCapabilityRegistry(
            new ManualClock(InitialTime),
            installed: true);
        var first = new TestAdapter();
        var second = new TestAdapter();

        Assert.True(registry.TryRegister(first));
        var registeredRevision = registry.Status.Revision;
        Assert.True(registry.TryRegister(first));
        Assert.Equal(registeredRevision, registry.Status.Revision);
        Assert.False(registry.TryRegister(second));
        Assert.False(registry.TryUnregister(second));
        Assert.True(registry.TryGetAdapter(out var current));
        Assert.Same(first, current);
        Assert.Equal("ready", registry.Status.StateName);

        Assert.True(registry.TryUnregister(first));
        Assert.False(registry.TryGetAdapter(out current));
        Assert.Null(current);
        Assert.Equal("not_loaded", registry.Status.StateName);

        Assert.True(registry.TryRegister(second));
        Assert.True(registry.TryGetAdapter(out current));
        Assert.Same(second, current);
    }

    [Fact]
    public void LiveAdapterCannotBeReplacedOrMarkedUnavailable()
    {
        var registry = new GrasshopperCapabilityRegistry(
            new ManualClock(InitialTime),
            installed: true);
        var adapter = new TestAdapter();
        registry.TryRegister(adapter);
        var revision = registry.Status.Revision;

        Assert.False(registry.SetInstalled(false));
        Assert.False(registry.MarkLoading());
        Assert.False(registry.MarkFailed("FAILED", "failure"));
        Assert.Equal(revision, registry.Status.Revision);
        Assert.Equal("ready", registry.Status.StateName);
    }

    [Fact]
    public void NotInstalledRegistryRejectsLoadAndFailureTransitions()
    {
        var registry = new GrasshopperCapabilityRegistry(
            new ManualClock(InitialTime),
            installed: false);

        Assert.False(registry.MarkLoading());
        Assert.False(registry.MarkFailed("FAILED", "failure"));
        Assert.Equal(0, registry.Status.Revision);
        Assert.Equal("not_installed", registry.Status.StateName);
    }

    [Theory]
    [InlineData(GrasshopperCapabilityState.NotInstalled, "not_installed")]
    [InlineData(GrasshopperCapabilityState.NotLoaded, "not_loaded")]
    [InlineData(GrasshopperCapabilityState.Loading, "loading")]
    [InlineData(GrasshopperCapabilityState.Ready, "ready")]
    [InlineData(GrasshopperCapabilityState.Failed, "failed")]
    public void StateProtocolValuesAreStable(GrasshopperCapabilityState state, string expected)
    {
        Assert.Equal(expected, state.ToProtocolValue());
    }

    private sealed class TestAdapter : IGrasshopperAdapter
    {
        public OperationDocumentStatus DocumentStatus => OperationDocumentStatus.None;
        public bool CanExecute(RpcOperation operation) => false;
        public OperationResultV2 Execute(RpcRequestV2 request) => new();
        public void CleanupOpenTransactions()
        {
        }
    }
}
