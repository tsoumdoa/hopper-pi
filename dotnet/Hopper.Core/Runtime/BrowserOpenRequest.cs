namespace Hopper.Core.Runtime;

/// <summary>Only an explicit UI request may open a browser; attachment recovery cannot open another tab.</summary>
public sealed class BrowserOpenRequest
{
    private bool _pending;

    public void Request(bool suppress = false) => _pending = !suppress;

    // The caller serializes lifecycle and readiness notifications.
    public bool Take(bool running, Uri? ready)
    {
        if (!_pending || !running || ready is null) return false;
        _pending = false;
        return true;
    }
}
