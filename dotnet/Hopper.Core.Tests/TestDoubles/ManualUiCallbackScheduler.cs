using Hopper.Core.Dispatching;

namespace Hopper.Core.Tests.TestDoubles;

internal sealed class ManualUiCallbackScheduler : IUiCallbackScheduler
{
    private readonly Queue<Action> _callbacks = new();

    public int PendingCount => _callbacks.Count;

    public void Post(Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        _callbacks.Enqueue(callback);
    }

    public void RunNext()
    {
        if (_callbacks.Count == 0)
            throw new InvalidOperationException("No UI callback is pending.");
        _callbacks.Dequeue()();
    }
}
