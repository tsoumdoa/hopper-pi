using Hopper.Core.Protocol;
using Hopper.Core.Operations;

namespace Hopper.Core.Grasshopper;

/// <summary>
/// Contract implemented by the lazy-loaded Grasshopper assembly. The contract exposes
/// only protocol and immutable status types so Rhino-owned code never references a
/// Grasshopper type.
/// </summary>
public interface IGrasshopperAdapter
{
    OperationDocumentStatus DocumentStatus { get; }
    bool CanExecute(RpcOperation operation);
    OperationResultV2 Execute(RpcRequestV2 request);
    void CleanupOpenTransactions();
}
