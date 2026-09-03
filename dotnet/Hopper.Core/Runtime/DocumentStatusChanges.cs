using Hopper.Core.Grasshopper;

namespace Hopper.Core.Runtime;

public enum HostDocumentKind
{
    Rhino,
    Grasshopper,
}

/// <summary>
/// A host UI event translated into Core data. Host assemblies must construct the
/// value on their UI thread before reporting it.
/// </summary>
public sealed record HostDocumentStatusChange(
    HostDocumentKind Kind,
    bool HasActiveDocument,
    string? DocumentName);

public interface IHostDocumentStatusSink
{
    void Report(HostDocumentStatusChange change);
}

/// <summary>
/// Publishes a hint that callers should read the authoritative runtime snapshot.
/// A wakeup can be delayed, duplicated, or dropped.
/// </summary>
public interface IRuntimeStatusWakeupPublisher
{
    void PublishStatusChanged(long revision);
}

/// <summary>
/// Applies document changes to the authoritative snapshot before sending an
/// advisory wakeup. Publication failure never rolls back the stored change.
/// </summary>
public sealed class HostDocumentStatusCoordinator : IHostDocumentStatusSink
{
    private readonly RuntimeStatusStore _status;
    private readonly GrasshopperCapabilityRegistry _grasshopper;
    private readonly IRuntimeStatusWakeupPublisher _wakeups;

    public HostDocumentStatusCoordinator(
        RuntimeStatusStore status,
        GrasshopperCapabilityRegistry grasshopper,
        IRuntimeStatusWakeupPublisher wakeups)
    {
        _status = status ?? throw new ArgumentNullException(nameof(status));
        _grasshopper = grasshopper ?? throw new ArgumentNullException(nameof(grasshopper));
        _wakeups = wakeups ?? throw new ArgumentNullException(nameof(wakeups));
    }

    public void Report(HostDocumentStatusChange change)
    {
        ArgumentNullException.ThrowIfNull(change);

        switch (change.Kind)
        {
            case HostDocumentKind.Rhino:
                _status.UpdateRhinoDocument(change.HasActiveDocument, change.DocumentName);
                break;
            case HostDocumentKind.Grasshopper:
                var capability = _grasshopper.Status;
                var active = capability.State == GrasshopperCapabilityState.Ready
                    && change.HasActiveDocument;
                _status.UpdateGrasshopper(
                    capability,
                    active,
                    active ? change.DocumentName : null);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(change));
        }

        var revision = _status.Read().Revision;
        try
        {
            _wakeups.PublishStatusChanged(revision);
        }
        catch (Exception)
        {
            // The immutable snapshot remains authoritative. A later status read or
            // wakeup closes the gap left by a failed advisory publication.
        }
    }

    /// <summary>
    /// Closes the race where Grasshopper registered before the runtime status sink.
    /// The host must call this method from its UI thread because the adapter reads
    /// its active document while producing the Core-only status value.
    /// </summary>
    public bool ReportRegisteredGrasshopperDocument()
    {
        if (!_grasshopper.TryGetAdapter(out var adapter))
            return false;

        var document = adapter!.DocumentStatus;
        Report(new HostDocumentStatusChange(
            HostDocumentKind.Grasshopper,
            document.HasActiveDocument,
            document.DocumentName));
        return true;
    }
}

/// <summary>
/// Process-wide handoff between independently loaded host plug-ins and the one
/// runtime status owner.
/// </summary>
public sealed class HostDocumentStatusRegistry : IHostDocumentStatusSink
{
    private readonly object _gate = new();
    private IHostDocumentStatusSink? _sink;

    public bool IsRegistered
    {
        get
        {
            lock (_gate)
                return _sink != null;
        }
    }

    public bool TryRegister(IHostDocumentStatusSink sink)
    {
        ArgumentNullException.ThrowIfNull(sink);
        lock (_gate)
        {
            if (_sink != null)
                return ReferenceEquals(_sink, sink);
            _sink = sink;
            return true;
        }
    }

    public bool TryUnregister(IHostDocumentStatusSink sink)
    {
        ArgumentNullException.ThrowIfNull(sink);
        lock (_gate)
        {
            if (!ReferenceEquals(_sink, sink))
                return false;
            _sink = null;
            return true;
        }
    }

    public void Report(HostDocumentStatusChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        IHostDocumentStatusSink? sink;
        lock (_gate)
            sink = _sink;
        sink?.Report(change);
    }
}
