using Hopper.Core.Lifecycle;

namespace Hopper.Core.Tests.Lifecycle;

internal sealed class FakeLifecycleTransport : ILifecycleTransport
{
    public List<string>? Calls { get; set; }
    public bool IsRunning { get; private set; }
    public int StartCount { get; private set; }
    public int StopCount { get; private set; }
    public int SignalCount { get; private set; }
    public TimeSpan? HandshakeTimeout { get; private set; }
    public TimeSpan? StopTimeout { get; private set; }
    public TaskCompletionSource<LifecycleActionResult>? HandshakeGate { get; set; }
    public TaskCompletionSource<bool>? StopGate { get; set; }
    public TransportStartResult StartResult { get; set; } = new(
        true,
        true,
        new LifecycleTransportConnection("router", "publisher", "token"),
        "");
    public LifecycleActionResult HandshakeResult { get; set; } =
        LifecycleActionResult.Success();
    public bool StopResult { get; set; } = true;

    public Task<TransportStartResult> StartAsync(
        string lifecycleInstanceId,
        CancellationToken cancellationToken)
    {
        StartCount++;
        Calls?.Add("transport.start");
        if (StartResult.ResourceCreated)
            IsRunning = true;
        return Task.FromResult(StartResult);
    }

    public Task<LifecycleActionResult> WaitForAuthenticatedHandshakeAsync(
        string lifecycleInstanceId,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        HandshakeTimeout = timeout;
        Calls?.Add("transport.handshake");
        return HandshakeGate == null
            ? Task.FromResult(HandshakeResult)
            : HandshakeGate.Task.WaitAsync(cancellationToken);
    }

    public async Task<bool> StopAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        StopCount++;
        StopTimeout = timeout;
        Calls?.Add("transport.stop");
        var result = StopGate == null
            ? StopResult
            : await StopGate.Task.WaitAsync(cancellationToken);
        if (result)
            IsRunning = false;
        return result;
    }

    public void SignalStopNoWait()
    {
        SignalCount++;
        Calls?.Add("transport.signal");
    }
}
