using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Core.Tests.TestDoubles;
using System.Text.Json;
using Xunit;

namespace Hopper.Core.Tests.Runtime;

public sealed class HostDocumentStatusCoordinatorTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 3, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void DocumentEventUpdatesSnapshotBeforePublishingWakeup()
    {
        var fixture = new Fixture();

        fixture.Coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Rhino,
            true,
            "Tower.3dm"));

        Assert.Equal("Tower.3dm", fixture.Status.Read().Rhino.DocumentName);
        Assert.Equal(new long[] { 1 }, fixture.Wakeups.Revisions);
        Assert.Equal("Tower.3dm", fixture.Wakeups.Snapshots.Single().Rhino.DocumentName);
    }

    [Fact]
    public void RepeatedHostEventIsStillAnAdvisoryWakeupWithoutChangingRevision()
    {
        var fixture = new Fixture();
        var change = new HostDocumentStatusChange(
            HostDocumentKind.Rhino,
            true,
            "Tower.3dm");

        fixture.Coordinator.Report(change);
        fixture.Coordinator.Report(change);

        Assert.Equal(1, fixture.Status.Read().Revision);
        Assert.Equal(new long[] { 1, 1 }, fixture.Wakeups.Revisions);
    }

    [Fact]
    public void GrasshopperDocumentUsesCurrentCapabilityState()
    {
        var fixture = new Fixture();

        fixture.Coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Grasshopper,
            true,
            "Ignored.gh"));

        Assert.False(fixture.Status.Read().Grasshopper.ActiveDocument);
        Assert.Equal(GrasshopperState.not_loaded, fixture.Status.Read().Grasshopper.State);

        var adapter = new GrasshopperAdapter();
        Assert.True(fixture.Grasshopper.TryRegister(adapter));
        fixture.Coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Grasshopper,
            true,
            "Definition.gh"));

        Assert.Equal(GrasshopperState.ready, fixture.Status.Read().Grasshopper.State);
        Assert.True(fixture.Status.Read().Grasshopper.ActiveDocument);
        Assert.Equal("Definition.gh", fixture.Status.Read().Grasshopper.DocumentName);

        Assert.True(fixture.Grasshopper.TryUnregister(adapter));
        fixture.Coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Grasshopper,
            true,
            "Stale.gh"));
        Assert.Equal(GrasshopperState.not_loaded, fixture.Status.Read().Grasshopper.State);
        Assert.False(fixture.Status.Read().Grasshopper.ActiveDocument);
        Assert.Null(fixture.Status.Read().Grasshopper.DocumentName);
    }

    [Fact]
    public void LateStatusOwnerSamplesAnAlreadyRegisteredGrasshopperAdapter()
    {
        var fixture = new Fixture();
        var adapter = new GrasshopperAdapter(
            new OperationDocumentStatus(true, "Preloaded.gh"));
        Assert.True(fixture.Grasshopper.TryRegister(adapter));

        Assert.True(fixture.Coordinator.ReportRegisteredGrasshopperDocument());

        Assert.Equal(1, adapter.DocumentStatusReadCount);
        Assert.True(fixture.Status.Read().Grasshopper.ActiveDocument);
        Assert.Equal("Preloaded.gh", fixture.Status.Read().Grasshopper.DocumentName);
        Assert.Equal(new long[] { 1 }, fixture.Wakeups.Revisions);
    }

    [Fact]
    public void WakeupFailureDoesNotRollBackAuthoritativeStatus()
    {
        var fixture = new Fixture(throwOnPublish: true);

        fixture.Coordinator.Report(new HostDocumentStatusChange(
            HostDocumentKind.Rhino,
            true,
            "Saved.3dm"));

        Assert.Equal(1, fixture.Status.Read().Revision);
        Assert.Equal("Saved.3dm", fixture.Status.Read().Rhino.DocumentName);
    }

    [Fact]
    public void RegistryUsesSameInstanceRegistrationAndIgnoresReportsWithoutOwner()
    {
        var registry = new HostDocumentStatusRegistry();
        var first = new RecordingSink();
        var second = new RecordingSink();
        var change = new HostDocumentStatusChange(HostDocumentKind.Rhino, false, null);

        registry.Report(change);
        Assert.True(registry.TryRegister(first));
        Assert.True(registry.TryRegister(first));
        Assert.False(registry.TryRegister(second));
        registry.Report(change);
        Assert.Single(first.Changes);
        Assert.False(registry.TryUnregister(second));
        Assert.True(registry.TryUnregister(first));
        registry.Report(change);
        Assert.Single(first.Changes);
    }

    [Fact]
    public void CoreDocumentContractHasNoRhinoOrGrasshopperAssemblyReference()
    {
        var references = typeof(HostDocumentStatusChange).Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name)
            .ToArray();

        Assert.DoesNotContain("RhinoCommon", references);
        Assert.DoesNotContain("Grasshopper", references);
    }

    [Fact]
    public void WakeupWireValueContainsOnlyProtocolVersionAndRevision()
    {
        var json = JsonSerializer.Serialize(
            new RuntimeStatusWakeupV2
            {
                ProtocolVersion = RpcV2Contract.ProtocolVersion,
                Revision = 42,
            },
            RpcV2Contract.JsonOptions);

        Assert.Equal("hopper.status.changed", RuntimeStatusWakeup.Topic);
        Assert.Equal("{\"protocolVersion\":2,\"revision\":42}", json);
    }

    private sealed class Fixture
    {
        public Fixture(bool throwOnPublish = false)
        {
            var clock = new ManualClock(Now);
            Grasshopper = new GrasshopperCapabilityRegistry(clock, installed: true);
            Status = new RuntimeStatusStore(
                clock,
                new DispatcherStatus(true, false, false, 0, 64, 0, 1),
                Grasshopper.Status);
            Wakeups = new RecordingWakeups(Status, throwOnPublish);
            Coordinator = new HostDocumentStatusCoordinator(Status, Grasshopper, Wakeups);
        }

        public GrasshopperCapabilityRegistry Grasshopper { get; }
        public RuntimeStatusStore Status { get; }
        public RecordingWakeups Wakeups { get; }
        public HostDocumentStatusCoordinator Coordinator { get; }
    }

    private sealed class RecordingWakeups : IRuntimeStatusWakeupPublisher
    {
        private readonly RuntimeStatusStore _status;
        private readonly bool _throwOnPublish;

        public RecordingWakeups(RuntimeStatusStore status, bool throwOnPublish)
        {
            _status = status;
            _throwOnPublish = throwOnPublish;
        }

        public List<long> Revisions { get; } = new();
        public List<RuntimeStatusV2> Snapshots { get; } = new();

        public void PublishStatusChanged(long revision)
        {
            if (_throwOnPublish)
                throw new InvalidOperationException("publisher unavailable");
            Revisions.Add(revision);
            Snapshots.Add(_status.Read());
        }
    }

    private sealed class RecordingSink : IHostDocumentStatusSink
    {
        public List<HostDocumentStatusChange> Changes { get; } = new();
        public void Report(HostDocumentStatusChange change) => Changes.Add(change);
    }

    private sealed class GrasshopperAdapter : IGrasshopperAdapter
    {
        private readonly OperationDocumentStatus _documentStatus;

        public GrasshopperAdapter(OperationDocumentStatus? documentStatus = null)
        {
            _documentStatus = documentStatus ?? OperationDocumentStatus.None;
        }

        public int DocumentStatusReadCount { get; private set; }
        public OperationDocumentStatus DocumentStatus
        {
            get
            {
                DocumentStatusReadCount++;
                return _documentStatus;
            }
        }
        public bool CanExecute(RpcOperation operation) => false;
        public OperationResultV2 Execute(RpcRequestV2 request) => new();
        public void CleanupOpenTransactions()
        {
        }
    }
}
