using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Channels;
using Hopper.Core;
using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Runtime;
using Hopper.Core.Time;
using Hopper.Rhino.Host;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class NodeHealthMonitorTests
{
    [Fact]
    public async Task ThreeFailedPollsUpdateStatusThenFaultAndCleanUp()
    {
        var fixture = await HealthFixture.StartAsync(
            NodeHealthProbeResult.Unhealthy,
            NodeHealthProbeResult.Unhealthy,
            NodeHealthProbeResult.Unhealthy);

        fixture.Monitor.OnRunning();
        await fixture.Delay.WaitUntilBlockedAsync();

        fixture.Delay.Tick();
        await fixture.Delay.WaitUntilBlockedAsync();
        Assert.Equal(1, fixture.Status.Read().Host.HealthFailureCount);
        Assert.Equal(LifecycleState.Running, fixture.Controller.Snapshot.State);

        fixture.Delay.Tick();
        await fixture.Delay.WaitUntilBlockedAsync();
        Assert.Equal(2, fixture.Status.Read().Host.HealthFailureCount);
        Assert.Equal(LifecycleState.Running, fixture.Controller.Snapshot.State);

        fixture.Delay.Tick();
        await fixture.Scheduler.Active!.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(3, fixture.Status.Read().Host.HealthFailureCount);
        Assert.Equal(LifecycleState.Faulted, fixture.Controller.Snapshot.State);
        Assert.Equal(LifecycleReasonCode.HealthFailureThresholdReached, fixture.Controller.Snapshot.Reason);
        Assert.Equal(1, fixture.Child.GracefulStopCount);
        Assert.Equal(1, fixture.Transport.StopCount);
        Assert.Equal(1, fixture.Profiles.DeleteCount);
        Assert.Equal(1, fixture.Transactions.CleanupCount);
    }

    [Fact]
    public async Task HealthyPollResetsTransientFailureCount()
    {
        var fixture = await HealthFixture.StartAsync(
            NodeHealthProbeResult.Unhealthy,
            NodeHealthProbeResult.Healthy);

        fixture.Monitor.OnRunning();
        await fixture.Delay.WaitUntilBlockedAsync();
        fixture.Delay.Tick();
        await fixture.Delay.WaitUntilBlockedAsync();
        Assert.Equal(1, fixture.Status.Read().Host.HealthFailureCount);

        fixture.Delay.Tick();
        await fixture.Delay.WaitUntilBlockedAsync();

        Assert.Equal(0, fixture.Status.Read().Host.HealthFailureCount);
        Assert.Equal(LifecycleReasonCode.HealthCheckRecovered, fixture.Controller.Snapshot.Reason);
        fixture.Monitor.Reset();
        await fixture.Scheduler.Active!.WaitAsync(TimeSpan.FromSeconds(2));
    }

    [Fact]
    public async Task MissingReadyEndpointCountsAsAHealthFailure()
    {
        var fixture = await HealthFixture.StartAsync(NodeHealthProbeResult.EndpointUnavailable);

        fixture.Monitor.OnRunning();
        await fixture.Delay.WaitUntilBlockedAsync();
        fixture.Delay.Tick();
        await fixture.Delay.WaitUntilBlockedAsync();

        Assert.Equal(1, fixture.Controller.Snapshot.ConsecutiveHealthFailures);
        fixture.Monitor.Reset();
        await fixture.Scheduler.Active!.WaitAsync(TimeSpan.FromSeconds(2));
    }

    [Fact]
    public async Task ResetCancelsBlockedPollWithoutWaitingForItsInterval()
    {
        var fixture = await HealthFixture.StartAsync(NodeHealthProbeResult.Healthy);
        fixture.Monitor.OnRunning();
        await fixture.Delay.WaitUntilBlockedAsync();

        fixture.Monitor.Reset();

        await fixture.Scheduler.Active!.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(0, fixture.Probe.CallCount);
    }

    [Fact]
    public async Task HttpProbeRequiresCurrentInstanceAndLiveHandshake()
    {
        var endpoint = new EndpointSource(new Uri(
            "http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345"));
        var handler = new StubHttpHandler(_ => Json(
            "{\"ok\":true,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":true}"));
        using var http = new HttpClient(handler);
        using var probe = new HttpNodeHealthProbe(endpoint, http);

        var result = await probe.CheckAsync("life-1", CancellationToken.None);

        Assert.Equal(NodeHealthProbeResult.Healthy, result);
        Assert.Equal("http://127.0.0.1:43821/health", handler.RequestUri!.AbsoluteUri);
    }

    [Theory]
    [InlineData("{\"ok\":true,\"lifecycleInstanceId\":\"life-old\",\"protocolHandshakeLive\":true}")]
    [InlineData("{\"ok\":true,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":false}")]
    [InlineData("{\"ok\":true}")]
    public async Task HttpProbeRejectsStaleOrIncompleteHealth(string body)
    {
        var endpoint = new EndpointSource(new Uri(
            "http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345"));
        using var http = new HttpClient(new StubHttpHandler(_ => Json(body)));
        using var probe = new HttpNodeHealthProbe(endpoint, http);

        Assert.Equal(
            NodeHealthProbeResult.Unhealthy,
            await probe.CheckAsync("life-1", CancellationToken.None));
    }

    [Fact]
    public async Task HttpProbeSkipsRequestsUntilReadyEndpointExists()
    {
        var handler = new StubHttpHandler(_ => Json("{}"));
        using var http = new HttpClient(handler);
        using var probe = new HttpNodeHealthProbe(new EndpointSource(null), http);

        Assert.Equal(
            NodeHealthProbeResult.EndpointUnavailable,
            await probe.CheckAsync("life-1", CancellationToken.None));
        Assert.Null(handler.RequestUri);
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    private sealed class HealthFixture
    {
        private HealthFixture(params NodeHealthProbeResult[] results)
        {
            Probe = new QueuedProbe(results);
            Status = new RuntimeStatusStore(
                SystemHopperClock.Instance,
                new DispatcherStatus(false, false, false, 0, 64, 0, 1),
                new GrasshopperCapabilityRegistry(SystemHopperClock.Instance, installed: true).Status);
            Controller = new LifecycleController(
                new NodeProvider(),
                Transport,
                Profiles,
                Child,
                new Dispatcher(),
                Transactions,
                new InstanceIds(),
                new ImmediateScheduler(),
                SystemHopperClock.Instance);
            Monitor = new NodeHealthMonitor(
                Controller,
                Status,
                Probe,
                Delay,
                Scheduler,
                new NodeHealthMonitorOptions(TimeSpan.FromMinutes(1)));
        }

        public LifecycleController Controller { get; }
        public RuntimeStatusStore Status { get; }
        public FakeTransport Transport { get; } = new();
        public Profiles Profiles { get; } = new();
        public Child Child { get; } = new();
        public Transactions Transactions { get; } = new();
        public QueuedProbe Probe { get; }
        public ManualDelay Delay { get; } = new();
        public RunningScheduler Scheduler { get; } = new();
        public NodeHealthMonitor Monitor { get; }

        public static async Task<HealthFixture> StartAsync(params NodeHealthProbeResult[] results)
        {
            var fixture = new HealthFixture(results);
            await fixture.Controller.StartAsync();
            fixture.Status.UpdateLifecycle(fixture.Controller.Snapshot);
            return fixture;
        }
    }

    private sealed class ManualDelay : IHealthPollDelay
    {
        private readonly Channel<bool> _ticks = Channel.CreateUnbounded<bool>();
        private readonly Channel<bool> _blocked = Channel.CreateUnbounded<bool>();

        public async Task WaitAsync(TimeSpan delay, CancellationToken cancellationToken)
        {
            _blocked.Writer.TryWrite(true);
            await _ticks.Reader.ReadAsync(cancellationToken);
        }

        public void Tick() => _ticks.Writer.TryWrite(true);

        public async Task WaitUntilBlockedAsync() =>
            await _blocked.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
    }

    private sealed class QueuedProbe : INodeHealthProbe
    {
        private readonly Queue<NodeHealthProbeResult> _results;

        public QueuedProbe(IEnumerable<NodeHealthProbeResult> results)
        {
            _results = new Queue<NodeHealthProbeResult>(results);
        }

        public int CallCount { get; private set; }

        public Task<NodeHealthProbeResult> CheckAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CallCount++;
            return Task.FromResult(
                _results.Count > 0 ? _results.Dequeue() : NodeHealthProbeResult.Healthy);
        }
    }

    private sealed class RunningScheduler : ILifecycleBackgroundScheduler
    {
        public Task? Active { get; private set; }

        public Task Schedule(Func<Task> operation)
        {
            Active = Task.Run(operation);
            return Active;
        }
    }

    private sealed class ImmediateScheduler : ILifecycleBackgroundScheduler
    {
        public Task Schedule(Func<Task> operation) => operation();
    }

    private sealed class EndpointSource : INodeHealthEndpointSource
    {
        private readonly Uri? _ready;

        public EndpointSource(Uri? ready)
        {
            _ready = ready;
        }

        public Uri? GetReadyUri(string lifecycleInstanceId) => _ready;
    }

    private sealed class StubHttpHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _response;

        public StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> response)
        {
            _response = response;
        }

        public Uri? RequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestUri = request.RequestUri;
            return Task.FromResult(_response(request));
        }
    }

    private sealed class NodeProvider : INodeRuntimeProvider
    {
        public Task<NodeRuntimeResolution> ResolveAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(NodeRuntimeResolution.Success(
                new NodeRuntime("/node", new NodeRuntimeVersion(22, 19, 0), NodeRuntimeSource.StandardPath)));
    }

    private sealed class FakeTransport : ILifecycleTransport
    {
        public bool IsRunning { get; private set; }
        public int StopCount { get; private set; }

        public Task<TransportStartResult> StartAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            IsRunning = true;
            return Task.FromResult(new TransportStartResult(
                true,
                true,
                new LifecycleTransportConnection("router", "publisher", "token"),
                ""));
        }

        public Task<LifecycleActionResult> WaitForAuthenticatedHandshakeAsync(
            string lifecycleInstanceId,
            TimeSpan timeout,
            CancellationToken cancellationToken) => Task.FromResult(LifecycleActionResult.Success());

        public Task<bool> StopAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            StopCount++;
            IsRunning = false;
            return Task.FromResult(true);
        }

        public void SignalStopNoWait() => IsRunning = false;
    }

    private sealed class Profiles : IInstanceProfileStore
    {
        public int DeleteCount { get; private set; }

        public Task<ProfileWriteResult> WriteAsync(
            string lifecycleInstanceId,
            LifecycleTransportConnection connection,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ProfileWriteResult(true, true, "/profile", ""));

        public Task<LifecycleActionResult> DeleteOwnedAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            DeleteCount++;
            return Task.FromResult(LifecycleActionResult.Success());
        }
    }

    private sealed class Child : IManagedChildProcess
    {
        public bool IsAlive { get; private set; }
        public int GracefulStopCount { get; private set; }

        public Task<ChildStartResult> StartAsync(
            NodeRuntime runtime,
            string profilePath,
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            IsAlive = true;
            return Task.FromResult(new ChildStartResult(true, true, ""));
        }

        public Task<bool> RequestGracefulStopAsync(
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            GracefulStopCount++;
            IsAlive = false;
            return Task.FromResult(true);
        }

        public void KillVerifiedTreeNoWait() => IsAlive = false;

        public Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
            Task.FromResult(true);
    }

    private sealed class Dispatcher : ILifecycleDispatcher
    {
        public void CloseExternalAdmission()
        {
        }

        public bool ReopenExternalAdmission() => true;
        public int CancelQueuedExternal() => 0;

        public Task<DispatcherResult<bool>> SubmitLifecycleControl(
            Action operation,
            DateTimeOffset? startDeadlineAt = null,
            CancellationToken cancellationToken = default)
        {
            operation();
            return Task.FromResult(DispatcherResult<bool>.Completed(true));
        }
    }

    private sealed class Transactions : IAgentTransactionCleanup
    {
        public int CleanupCount { get; private set; }

        public void CleanupOpenTransactions() => CleanupCount++;
    }

    private sealed class InstanceIds : ILifecycleInstanceIdSource
    {
        public string Create() => "life-1";
    }
}
