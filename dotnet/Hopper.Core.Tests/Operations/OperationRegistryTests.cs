using Hopper.Core.Grasshopper;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Tests.TestDoubles;
using Xunit;

namespace Hopper.Core.Tests.Operations;

public sealed class OperationRegistryTests
{
    [Fact]
    public void RhinoRegistrationIsCompareAndSetAndSameInstanceUnregisters()
    {
        var registry = new RhinoOperationRegistry();
        var first = new RhinoAdapter(RpcOperation.runRhinoScript);
        var second = new RhinoAdapter(RpcOperation.captureRhinoView);

        Assert.True(registry.TryRegister(first));
        Assert.True(registry.TryRegister(first));
        Assert.False(registry.TryRegister(second));
        Assert.False(registry.TryUnregister(second));
        Assert.True(registry.TryGetAdapter(out var current));
        Assert.Same(first, current);
        Assert.True(registry.TryUnregister(first));
        Assert.False(registry.IsRegistered);
    }

    [Fact]
    public void RouterPrefersRegisteredRhinoHandler()
    {
        var rhino = new RhinoOperationRegistry();
        var grasshopper = Registry(installed: false);
        var adapter = new RhinoAdapter(RpcOperation.runRhinoScript);
        rhino.TryRegister(adapter);

        var result = new HostOperationRouter(rhino, grasshopper).Execute(
            Request(RpcOperation.runRhinoScript));

        Assert.Equal(RpcResultClass.completed, result.Class);
        Assert.Equal(1, adapter.ExecuteCount);
    }

    [Fact]
    public void RouterRejectsGrasshopperWorkWithoutActiveDocument()
    {
        var grasshopper = Registry(installed: true);
        var adapter = new GrasshopperAdapter(
            RpcOperation.addComponent,
            OperationDocumentStatus.None);
        grasshopper.TryRegister(adapter);

        var result = new HostOperationRouter(new RhinoOperationRegistry(), grasshopper)
            .Execute(Request(RpcOperation.addComponent));

        Assert.Equal(RpcResultClass.no_active_grasshopper_document, result.Class);
        Assert.Equal(RpcReasonCode.NO_ACTIVE_GRASSHOPPER_DOCUMENT, result.ReasonCode);
        Assert.Equal(0, adapter.ExecuteCount);
    }

    [Fact]
    public void RouterDispatchesGrasshopperWorkWithActiveDocument()
    {
        var grasshopper = Registry(installed: true);
        var adapter = new GrasshopperAdapter(
            RpcOperation.addComponent,
            new OperationDocumentStatus(true, "Model"));
        grasshopper.TryRegister(adapter);

        var result = new HostOperationRouter(new RhinoOperationRegistry(), grasshopper)
            .Execute(Request(RpcOperation.addComponent));

        Assert.Equal(RpcResultClass.completed, result.Class);
        Assert.Equal(1, adapter.ExecuteCount);
    }

    [Fact]
    public void RouterReportsTypedUnavailableCapability()
    {
        var result = new HostOperationRouter(
                new RhinoOperationRegistry(),
                Registry(installed: false))
            .Execute(Request(RpcOperation.addComponent));

        Assert.Equal(RpcResultClass.capability_unavailable, result.Class);
        Assert.Equal(RpcReasonCode.GRASSHOPPER_NOT_INSTALLED, result.ReasonCode);
    }

    [Fact]
    public void TransactionCleanupUsesOnlyTheRegisteredGrasshopperAdapter()
    {
        var registry = Registry(installed: true);
        var adapter = new GrasshopperAdapter(
            RpcOperation.addComponent,
            new OperationDocumentStatus(true, "Model"));
        var cleanup = new RegisteredGrasshopperTransactionCleanup(registry);

        cleanup.CleanupOpenTransactions();
        registry.TryRegister(adapter);
        cleanup.CleanupOpenTransactions();
        registry.TryUnregister(adapter);
        cleanup.CleanupOpenTransactions();

        Assert.Equal(1, adapter.CleanupCount);
    }

    [Fact]
    public void CoreAssemblyDoesNotReferenceHostSdkAssemblies()
    {
        var references = typeof(HostOperationRouter).Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name)
            .ToArray();

        Assert.DoesNotContain("RhinoCommon", references);
        Assert.DoesNotContain("Grasshopper", references);
    }

    private static GrasshopperCapabilityRegistry Registry(bool installed) =>
        new(
            new ManualClock(new DateTimeOffset(2026, 4, 5, 6, 7, 8, TimeSpan.Zero)),
            installed);

    private static RpcRequestV2 Request(RpcOperation operation) => new()
    {
        Operation = operation,
    };

    private sealed class RhinoAdapter : IRhinoOperationAdapter
    {
        private readonly RpcOperation _operation;

        public RhinoAdapter(RpcOperation operation)
        {
            _operation = operation;
        }

        public int ExecuteCount { get; private set; }
        public OperationDocumentStatus DocumentStatus => OperationDocumentStatus.None;
        public bool CanExecute(RpcOperation operation) => operation == _operation;

        public OperationResultV2 Execute(RpcRequestV2 request)
        {
            ExecuteCount++;
            return Completed();
        }
    }

    private sealed class GrasshopperAdapter : IGrasshopperAdapter
    {
        private readonly RpcOperation _operation;

        public GrasshopperAdapter(
            RpcOperation operation,
            OperationDocumentStatus documentStatus)
        {
            _operation = operation;
            DocumentStatus = documentStatus;
        }

        public OperationDocumentStatus DocumentStatus { get; }
        public int ExecuteCount { get; private set; }
        public int CleanupCount { get; private set; }
        public bool CanExecute(RpcOperation operation) => operation == _operation;

        public OperationResultV2 Execute(RpcRequestV2 request)
        {
            ExecuteCount++;
            return Completed();
        }

        public void CleanupOpenTransactions() => CleanupCount++;
    }

    private static OperationResultV2 Completed() => new()
    {
        Class = RpcResultClass.completed,
        ReasonCode = RpcReasonCode.OK,
    };
}
