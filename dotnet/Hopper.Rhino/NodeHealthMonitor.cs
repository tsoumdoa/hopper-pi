#nullable enable

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core.Lifecycle;
using Hopper.Core.Runtime;

namespace Hopper.Rhino.Host
{
    public enum NodeHealthProbeResult
    {
        EndpointUnavailable,
        Healthy,
        Unhealthy,
    }

    public interface INodeHealthEndpointSource
    {
        Uri? GetReadyUri(string lifecycleInstanceId);
    }

    public interface INodeHealthProbe
    {
        Task<NodeHealthProbeResult> CheckAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken);
    }

    public interface IHealthPollDelay
    {
        Task WaitAsync(TimeSpan delay, CancellationToken cancellationToken);
    }

    public sealed record NodeHealthMonitorOptions(TimeSpan PollInterval)
    {
        public static NodeHealthMonitorOptions Default { get; } = new(TimeSpan.FromSeconds(5));
    }

    public sealed class SystemHealthPollDelay : IHealthPollDelay
    {
        public static SystemHealthPollDelay Instance { get; } = new();

        private SystemHealthPollDelay()
        {
        }

        public Task WaitAsync(TimeSpan delay, CancellationToken cancellationToken) =>
            Task.Delay(delay, cancellationToken);
    }

    public sealed class HttpNodeHealthProbe : INodeHealthProbe, IDisposable
    {
        private readonly INodeHealthEndpointSource _endpoints;
        private readonly HttpClient _http;
        private readonly bool _ownsHttpClient;

        public HttpNodeHealthProbe(
            INodeHealthEndpointSource endpoints,
            TimeSpan requestTimeout)
        {
            if (requestTimeout <= TimeSpan.Zero)
                throw new ArgumentOutOfRangeException(nameof(requestTimeout));
            _endpoints = endpoints ?? throw new ArgumentNullException(nameof(endpoints));
            _http = new HttpClient { Timeout = requestTimeout };
            _ownsHttpClient = true;
        }

        public HttpNodeHealthProbe(
            INodeHealthEndpointSource endpoints,
            HttpClient http)
        {
            _endpoints = endpoints ?? throw new ArgumentNullException(nameof(endpoints));
            _http = http ?? throw new ArgumentNullException(nameof(http));
        }

        public async Task<NodeHealthProbeResult> CheckAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(lifecycleInstanceId))
                throw new ArgumentException("Lifecycle instance ID is required.", nameof(lifecycleInstanceId));

            var ready = _endpoints.GetReadyUri(lifecycleInstanceId);
            if (ready == null)
                return NodeHealthProbeResult.EndpointUnavailable;

            try
            {
                var health = new Uri(ready.GetLeftPart(UriPartial.Authority) + "/health");
                using var response = await _http.GetAsync(health, cancellationToken)
                    .ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                    return NodeHealthProbeResult.Unhealthy;

                await using var body = await response.Content.ReadAsStreamAsync(cancellationToken)
                    .ConfigureAwait(false);
                using var json = await JsonDocument.ParseAsync(
                        body,
                        cancellationToken: cancellationToken)
                    .ConfigureAwait(false);
                var root = json.RootElement;
                return root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("ok", out var ok)
                    && ok.ValueKind == JsonValueKind.True
                    && root.TryGetProperty("lifecycleInstanceId", out var instance)
                    && instance.ValueKind == JsonValueKind.String
                    && string.Equals(instance.GetString(), lifecycleInstanceId, StringComparison.Ordinal)
                    && root.TryGetProperty("protocolHandshakeLive", out var handshake)
                    && handshake.ValueKind == JsonValueKind.True
                        ? NodeHealthProbeResult.Healthy
                        : NodeHealthProbeResult.Unhealthy;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                return NodeHealthProbeResult.Unhealthy;
            }
        }

        public void Dispose()
        {
            if (_ownsHttpClient)
                _http.Dispose();
        }
    }

    public sealed class NodeHealthMonitor : IHopperRunningObserver, IDisposable
    {
        private readonly object _gate = new();
        private readonly LifecycleController _lifecycle;
        private readonly RuntimeStatusStore _status;
        private readonly INodeHealthProbe _probe;
        private readonly IHealthPollDelay _delay;
        private readonly ILifecycleBackgroundScheduler _background;
        private readonly NodeHealthMonitorOptions _options;
        private CancellationTokenSource? _active;
        private int _disposed;

        public NodeHealthMonitor(
            LifecycleController lifecycle,
            RuntimeStatusStore status,
            INodeHealthProbe probe,
            IHealthPollDelay delay,
            ILifecycleBackgroundScheduler background,
            NodeHealthMonitorOptions? options = null)
        {
            _lifecycle = lifecycle ?? throw new ArgumentNullException(nameof(lifecycle));
            _status = status ?? throw new ArgumentNullException(nameof(status));
            _probe = probe ?? throw new ArgumentNullException(nameof(probe));
            _delay = delay ?? throw new ArgumentNullException(nameof(delay));
            _background = background ?? throw new ArgumentNullException(nameof(background));
            _options = options ?? NodeHealthMonitorOptions.Default;
            if (_options.PollInterval <= TimeSpan.Zero)
                throw new ArgumentOutOfRangeException(nameof(options));
        }

        public void OnRunning()
        {
            var snapshot = _lifecycle.Snapshot;
            if (snapshot.State != LifecycleState.Running
                || string.IsNullOrWhiteSpace(snapshot.LifecycleInstanceId)
                || Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            var cancellation = new CancellationTokenSource();
            CancellationTokenSource? previous;
            lock (_gate)
            {
                if (_disposed != 0)
                {
                    cancellation.Dispose();
                    return;
                }
                previous = _active;
                previous?.Cancel();
                _active = cancellation;
            }

            try
            {
                _ = _background.Schedule(() => PollAsync(
                    snapshot.LifecycleInstanceId,
                    cancellation));
            }
            catch
            {
                lock (_gate)
                {
                    if (ReferenceEquals(_active, cancellation))
                        _active = null;
                }
                cancellation.Cancel();
                cancellation.Dispose();
                throw;
            }
        }

        public void Reset()
        {
            lock (_gate)
            {
                _active?.Cancel();
                _active = null;
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;
            Reset();
        }

        private async Task PollAsync(
            string lifecycleInstanceId,
            CancellationTokenSource cancellation)
        {
            var token = cancellation.Token;
            try
            {
                while (!token.IsCancellationRequested)
                {
                    await _delay.WaitAsync(_options.PollInterval, token)
                        .ConfigureAwait(false);
                    var result = await _probe.CheckAsync(lifecycleInstanceId, token)
                        .ConfigureAwait(false);
                    token.ThrowIfCancellationRequested();
                    var report = _lifecycle.ReportHealthCheckAsync(
                        result == NodeHealthProbeResult.Healthy);
                    _status.UpdateLifecycle(_lifecycle.Snapshot);
                    await report.ConfigureAwait(false);
                    _status.UpdateLifecycle(_lifecycle.Snapshot);
                    if (_lifecycle.Snapshot.State != LifecycleState.Running)
                        return;
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
            }
            finally
            {
                lock (_gate)
                {
                    if (ReferenceEquals(_active, cancellation))
                        _active = null;
                }
                cancellation.Dispose();
            }
        }
    }

    public sealed class CompositeHopperRunningObserver : IHopperRunningObserver
    {
        private readonly IReadOnlyList<IHopperRunningObserver> _observers;

        public CompositeHopperRunningObserver(params IHopperRunningObserver[] observers)
        {
            ArgumentNullException.ThrowIfNull(observers);
            if (Array.Exists(observers, observer => observer == null))
                throw new ArgumentException("Observers cannot contain null.", nameof(observers));
            _observers = observers;
        }

        public void Reset()
        {
            foreach (var observer in _observers)
                observer.Reset();
        }

        public void OnRunning()
        {
            foreach (var observer in _observers)
                observer.OnRunning();
        }
    }
}
