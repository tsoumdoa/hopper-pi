namespace Hopper.Core.Dispatching;

public interface ILifecycleDispatcher
{
    void CloseExternalAdmission();
    bool ReopenExternalAdmission();
    int CancelQueuedExternal();

    Task<DispatcherResult<bool>> SubmitLifecycleControl(
        Action operation,
        DateTimeOffset? startDeadlineAt = null,
        CancellationToken cancellationToken = default);
}
