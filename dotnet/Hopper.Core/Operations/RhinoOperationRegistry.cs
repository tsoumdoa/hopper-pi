using Hopper.Core.Protocol;

namespace Hopper.Core.Operations;

/// <summary>
/// Rhino-only operation boundary consumed by Core routing without a RhinoCommon
/// reference. The Rhino assembly owns the concrete implementation.
/// </summary>
public interface IRhinoOperationAdapter
{
    OperationDocumentStatus DocumentStatus { get; }
    bool CanExecute(RpcOperation operation);
    OperationResultV2 Execute(RpcRequestV2 request);
}

public sealed record OperationDocumentStatus(bool HasActiveDocument, string? DocumentName)
{
    public static OperationDocumentStatus None { get; } = new(false, null);
}

public sealed class RhinoOperationRegistry
{
    private readonly object _gate = new();
    private IRhinoOperationAdapter? _adapter;

    public bool IsRegistered
    {
        get
        {
            lock (_gate)
                return _adapter != null;
        }
    }

    public bool TryRegister(IRhinoOperationAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(adapter);
        lock (_gate)
        {
            if (_adapter != null)
                return ReferenceEquals(_adapter, adapter);
            _adapter = adapter;
            return true;
        }
    }

    public bool TryUnregister(IRhinoOperationAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(adapter);
        lock (_gate)
        {
            if (!ReferenceEquals(_adapter, adapter))
                return false;
            _adapter = null;
            return true;
        }
    }

    public bool TryGetAdapter(out IRhinoOperationAdapter? adapter)
    {
        lock (_gate)
        {
            adapter = _adapter;
            return adapter != null;
        }
    }
}
