namespace Hopper.Core.Runtime;

/// <summary>Serializes discovery and registration without disturbing a current attachment.</summary>
public sealed class SharedHostAttachmentRecovery
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Func<bool, CancellationToken, Task> _ensureHost;
    private readonly Func<bool> _isCurrentRegistration;
    private readonly Func<CancellationToken, Task> _register;

    public SharedHostAttachmentRecovery(
        Func<bool, CancellationToken, Task> ensureHost,
        Func<bool> isCurrentRegistration,
        Func<CancellationToken, Task> register)
    {
        _ensureHost = ensureHost;
        _isCurrentRegistration = isCurrentRegistration;
        _register = register;
    }

    public async Task EnsureAsync(bool explicitStart, bool forceRegistration, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _ensureHost(explicitStart, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            if (forceRegistration || !_isCurrentRegistration())
                await _register(cancellationToken).ConfigureAwait(false);
        }
        finally { _gate.Release(); }
    }
}
