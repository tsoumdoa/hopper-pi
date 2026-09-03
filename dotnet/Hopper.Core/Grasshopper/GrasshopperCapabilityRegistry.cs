using Hopper.Core.Time;

namespace Hopper.Core.Grasshopper;

/// <summary>
/// Holds the single live Grasshopper adapter and an immutable capability snapshot.
/// The adapter registers only after Grasshopper's component server is ready.
/// </summary>
public sealed class GrasshopperCapabilityRegistry
{
    private readonly object _gate = new();
    private readonly IHopperClock _clock;
    private IGrasshopperAdapter? _adapter;
    private bool _installed;
    private GrasshopperCapabilityStatus _status;

    public GrasshopperCapabilityRegistry(IHopperClock clock, bool installed)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _installed = installed;
        _status = new GrasshopperCapabilityStatus(
            0,
            _clock.UtcNow,
            installed ? GrasshopperCapabilityState.NotLoaded : GrasshopperCapabilityState.NotInstalled,
            null);
    }

    public GrasshopperCapabilityStatus Status
    {
        get
        {
            lock (_gate)
                return _status;
        }
    }

    public bool SetInstalled(bool installed)
    {
        lock (_gate)
        {
            if (_adapter != null)
                return false;

            _installed = installed;
            return SetStatus(
                installed ? GrasshopperCapabilityState.NotLoaded : GrasshopperCapabilityState.NotInstalled,
                null);
        }
    }

    public bool MarkLoading()
    {
        lock (_gate)
        {
            if (!_installed || _adapter != null)
                return false;
            return SetStatus(GrasshopperCapabilityState.Loading, null);
        }
    }

    public bool MarkFailed(string code, string message)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("A failure code is required.", nameof(code));
        if (string.IsNullOrWhiteSpace(message))
            throw new ArgumentException("A failure message is required.", nameof(message));

        lock (_gate)
        {
            if (!_installed || _adapter != null)
                return false;
            return SetStatus(
                GrasshopperCapabilityState.Failed,
                new GrasshopperCapabilityError(code, message));
        }
    }

    public bool TryRegister(IGrasshopperAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(adapter);

        lock (_gate)
        {
            if (_adapter != null)
                return ReferenceEquals(_adapter, adapter);

            _installed = true;
            _adapter = adapter;
            SetStatus(GrasshopperCapabilityState.Ready, null);
            return true;
        }
    }

    public bool TryUnregister(IGrasshopperAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(adapter);

        lock (_gate)
        {
            if (!ReferenceEquals(_adapter, adapter))
                return false;

            _adapter = null;
            SetStatus(
                _installed ? GrasshopperCapabilityState.NotLoaded : GrasshopperCapabilityState.NotInstalled,
                null);
            return true;
        }
    }

    public bool TryGetAdapter(out IGrasshopperAdapter? adapter)
    {
        lock (_gate)
        {
            adapter = _adapter;
            return adapter != null;
        }
    }

    private bool SetStatus(
        GrasshopperCapabilityState state,
        GrasshopperCapabilityError? error)
    {
        if (_status.State == state && _status.Error == error)
            return false;

        _status = new GrasshopperCapabilityStatus(
            checked(_status.Revision + 1),
            _clock.UtcNow,
            state,
            error);
        return true;
    }
}
