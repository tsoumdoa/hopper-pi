using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Hopper.Core.Dispatching;
using Hopper.Core.Protocol;
using Hopper.Core.Time;
using Hopper.Core.Transport;

const string token = "cross_language_rpc_token_0123456789abcdef";
const string lifecycleInstanceId = "life-cross-language-smoke";

try
{
    var routerEndpoint = ReserveLoopbackEndpoint();
    var publisherEndpoint = ReserveLoopbackEndpoint(routerEndpoint);
    using var scheduler = new DedicatedThreadScheduler();
    var dispatcher = new OrderedDispatcher(scheduler, SystemHopperClock.Instance);
    using var owner = new RpcTransportOwner(
        new RpcTransportOwnerOptions
        {
            RouterEndpoint = routerEndpoint,
            PublisherEndpoint = publisherEndpoint,
            ConnectionToken = token,
            LifecycleInstanceId = lifecycleInstanceId,
        },
        dispatcher,
        new CorrelationHandler(),
        SystemHopperClock.Instance,
        handshakeObserver: new HandshakeObserver());

    var start = owner.Start();
    if (start.State != RpcTransportStartState.Started)
        throw new InvalidOperationException(start.Error ?? $"Transport start returned {start.State}.");

    Console.WriteLine(JsonSerializer.Serialize(new
    {
        type = "ready",
        routerEndpoint,
        lifecycleInstanceId,
        token,
    }));
    Console.Out.Flush();

    if (!string.Equals(Console.ReadLine(), "shutdown", StringComparison.Ordinal))
        throw new InvalidOperationException("Expected the shutdown command on standard input.");

    var stop = owner.Stop(TimeSpan.FromSeconds(2));
    if (stop.State is not (RpcTransportStopState.Stopped or RpcTransportStopState.AlreadyStopped))
        throw new InvalidOperationException($"Transport stop returned {stop.State}.");
}
catch (Exception exception)
{
    Console.Error.WriteLine($"[cross-language-host] {exception}");
    Environment.ExitCode = 1;
}

static string ReserveLoopbackEndpoint(string? except = null)
{
    while (true)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var endpoint = $"tcp://127.0.0.1:{port}";
        if (!string.Equals(endpoint, except, StringComparison.Ordinal))
            return endpoint;
    }
}

sealed class HandshakeObserver : IRpcHandshakeObserver
{
    public RpcHandshakeObservation OnAuthenticatedHandshake(LifecycleHandshakeArgsV2 handshake) =>
        RpcHandshakeObservation.Allow(91);
}

sealed class CorrelationHandler : IRpcOperationHandler
{
    public OperationResultV2 Execute(RpcRequestV2 request) => new()
    {
        Class = RpcResultClass.completed,
        ReasonCode = RpcReasonCode.OK,
        Data = JsonSerializer.SerializeToElement(new
        {
            operation = request.Operation.ToString(),
            requestId = request.RequestId,
            operationId = request.OperationId,
            args = request.Args,
        }, RpcV2Contract.JsonOptions),
    };
}

sealed class DedicatedThreadScheduler : IUiCallbackScheduler, IDisposable
{
    private readonly BlockingCollection<Action> _callbacks = new();
    private readonly Thread _thread;

    public DedicatedThreadScheduler()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "Cross-language smoke dispatcher",
        };
        _thread.Start();
    }

    public void Post(Action callback) => _callbacks.Add(callback);

    public void Dispose()
    {
        _callbacks.CompleteAdding();
        if (!_thread.Join(TimeSpan.FromSeconds(2)))
            throw new TimeoutException("Dispatcher thread did not stop within two seconds.");
        _callbacks.Dispose();
    }

    private void Run()
    {
        foreach (var callback in _callbacks.GetConsumingEnumerable())
            callback();
    }
}
