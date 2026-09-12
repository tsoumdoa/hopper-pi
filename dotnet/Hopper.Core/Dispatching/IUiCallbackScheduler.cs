namespace Hopper.Core.Dispatching;

/// <summary>
/// Posts work to the host UI thread. Implementations must defer the callback rather
/// than invoke it inline.
/// </summary>
public interface IUiCallbackScheduler
{
    void Post(Action callback);
}
