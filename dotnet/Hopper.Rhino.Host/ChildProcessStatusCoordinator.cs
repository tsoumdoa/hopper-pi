using Hopper.Core.Runtime;

namespace Hopper.Rhino.Host;

public sealed class ChildProcessStatusCoordinator
{
    private readonly RuntimeStatusStore _status;

    public ChildProcessStatusCoordinator(RuntimeStatusStore status)
    {
        _status = status ?? throw new ArgumentNullException(nameof(status));
    }

    public void MarkStarted(
        HostRuntimeStatusUpdate started,
        Func<bool> hasAlreadyExited)
    {
        ArgumentNullException.ThrowIfNull(started);
        ArgumentNullException.ThrowIfNull(hasAlreadyExited);

        _status.UpdateHost(started);
        if (hasAlreadyExited())
            _status.UpdateHostProcessExited();
    }

    public void MarkExited() => _status.UpdateHostProcessExited();
}
