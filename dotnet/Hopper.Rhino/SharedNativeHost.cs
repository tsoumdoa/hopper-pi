using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core;
using Hopper.Core.Lifecycle;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;

namespace rhino_zmq_poc;

internal static class SharedNativeHost
{
    public static string BootstrapTicket { get; set; }
    public static bool SuppressBrowser { get; set; }
    public static string ControlDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".hopper", "shared-control");
    public static JsonElement Read(string name) => JsonDocument.Parse(File.ReadAllText(Path.Combine(ControlDirectory, name))).RootElement.Clone();
    public static bool CompatibleDiscovery(JsonElement control, JsonElement discovery) =>
        discovery.GetProperty("protocolVersion").GetInt32() == RpcV2Contract.ProtocolVersion &&
        discovery.GetProperty("schemaVersion").GetInt32() == 2 &&
        discovery.GetProperty("endpointPort").GetInt32() == control.GetProperty("endpointPort").GetInt32() &&
        discovery.GetProperty("journalIdentity").GetString() == control.GetProperty("journalIdentity").GetString() &&
        discovery.GetProperty("dataDirectory").GetString() == control.GetProperty("dataDirectory").GetString();
    public static bool IsCurrentHandshake(LifecycleHandshakeArgsV2 args)
    {
        try
        {
            var control = Read("control.json"); var discovery = Read("discovery.json");
            return CompatibleDiscovery(control, discovery) && control.GetProperty("desiredState").GetString() == "running" &&
                discovery.GetProperty("hostEpoch").GetString() == args.HostEpoch && discovery.GetProperty("pid").GetInt32() == args.NodeProcessId &&
                discovery.GetProperty("revision").GetInt64() == control.GetProperty("revision").GetInt64();
        }
        catch { return false; }
    }
}

/// <summary>Owns one attachment, never the shared Node process or another Rhino attachment.</summary>
internal sealed class SharedNodeAttachment : IDisposable
{
    private readonly HopperHostEntryResolver _entry;
    private readonly RuntimeStatusStore _status;
    private readonly SharedHostAttachmentRecovery _recovery;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private CancellationTokenSource _lifetime;
    private string _profile, _lifecycle, _epoch;
    private long _hostProcessStartTicks;
    private NodeRuntime _runtime;
    private volatile bool _attached;
    private bool _bootstrapRegistered;
    public Uri ReadyUri { get; private set; }
    public event Action<Uri> Ready;
    public bool IsAlive => _attached;
    public SharedNodeAttachment(HopperHostEntryResolver entry, RuntimeStatusStore status)
    {
        (_entry, _status) = (entry, status);
        _recovery = new SharedHostAttachmentRecovery(DiscoverOrStart, IsCurrentRegistration, Register);
    }

    public async Task<ChildStartResult> StartAsync(NodeRuntime runtime, string profile, string lifecycle, CancellationToken cancellationToken)
    {
        _runtime = runtime; _profile = profile; _lifecycle = lifecycle;
        _lifetime?.Cancel(); _lifetime = new CancellationTokenSource();
        try
        {
            await _recovery.EnsureAsync(SharedNativeHost.BootstrapTicket == null, true, cancellationToken).ConfigureAwait(false);
            _attached = true;
            _ = Reconnect(_lifetime.Token);
            return new(true, true, "Attached to the shared Hopper host.");
        }
        catch (Exception error) { _lifetime.Cancel(); return new(false, false, error.Message); }
    }

    // An explicit HopperCode command may restart a host the browser intentionally stopped.
    // The background reconnect path continues to respect the stopped intent.
    public Task EnsureRunningAsync() => _recovery.EnsureAsync(true, false, _lifetime?.Token ?? CancellationToken.None);

    private bool IsCurrentRegistration()
    {
        if (!_attached) return false;
        try
        {
            var control = SharedNativeHost.Read("control.json");
            var discovery = SharedNativeHost.Read("discovery.json");
            using var process = Process.GetProcessById(discovery.GetProperty("pid").GetInt32());
            return SharedNativeHost.CompatibleDiscovery(control, discovery) &&
                control.GetProperty("desiredState").GetString() == "running" &&
                control.GetProperty("revision").GetInt64() == discovery.GetProperty("revision").GetInt64() &&
                discovery.GetProperty("hostEpoch").GetString() == _epoch &&
                !process.HasExited && process.StartTime.ToUniversalTime().Ticks == _hostProcessStartTicks;
        }
        catch { return false; }
    }

    private async Task DiscoverOrStart(bool explicitStart, CancellationToken cancellationToken)
    {
        var entry = _entry.Resolve() ?? throw new InvalidOperationException("The compiled Hopper host entry was not found.");
        // The startup launcher performs singleton control and detached spawning. It has no Rhino parent watchdog.
        var info = new ProcessStartInfo(_runtime.ExecutablePath) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Path.GetDirectoryName(entry) };
        info.ArgumentList.Add(entry); info.ArgumentList.Add("--ensure-host");
        if (explicitStart) info.ArgumentList.Add("--explicit-start");
        using var launcher = Process.Start(info) ?? throw new InvalidOperationException("Could not start shared host launcher.");
        var stdout = launcher.StandardOutput.ReadToEndAsync(); var stderr = launcher.StandardError.ReadToEndAsync();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(TimeSpan.FromSeconds(20));
        await launcher.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
        await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (launcher.ExitCode != 0) throw new InvalidOperationException("Shared host startup failed: " + error);
    }

    private async Task Register(CancellationToken cancellationToken)
    {
        var control = SharedNativeHost.Read("control.json"); var discovery = SharedNativeHost.Read("discovery.json");
        if (control.GetProperty("desiredState").GetString() != "running" || control.GetProperty("revision").GetInt64() != discovery.GetProperty("revision").GetInt64())
            throw new InvalidOperationException("Shared host is intentionally stopped or discovery is stale.");
        var epoch = discovery.GetProperty("hostEpoch").GetString();
        var port = discovery.GetProperty("endpointPort").GetInt32();
        var credential = discovery.GetProperty("registrationToken").GetString();
        if (!SharedNativeHost.CompatibleDiscovery(control, discovery)) throw new InvalidOperationException("Shared host protocol, schema or pinned storage is incompatible. Stop, update and restart explicitly.");
        using (var hostProcess = Process.GetProcessById(discovery.GetProperty("pid").GetInt32()))
            _hostProcessStartTicks = hostProcess.StartTime.ToUniversalTime().Ticks;
        _status.UpdateHost(new HostRuntimeStatusUpdate(Hopper.Core.Lifecycle.LifecycleState.Starting,
            discovery.GetProperty("pid").GetInt32(), _runtime.ExecutablePath, _runtime.Version.ToString(), HandshakeState.connecting, 0));
        object bootstrap = null;
        if (!_bootstrapRegistered && SharedNativeHost.BootstrapTicket is { } ticketId)
        {
            var ticket = SharedNativeHost.Read(Path.Combine("bootstrap", ticketId + ".json"));
            if (ticket.GetProperty("expiresAt").GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) throw new InvalidOperationException("Launch bootstrap ticket expired.");
            using var process = Process.GetCurrentProcess();
            bootstrap = new { ticketId, nonce = ticket.GetProperty("nonce").GetString(), requestId = ticket.GetProperty("requestId").GetString(),
                installationId = ticket.GetProperty("installationId").GetString(), process = new { pid = process.Id, startIdentity = process.StartTime.ToUniversalTime().ToString("O") }, lifecycleInstanceId = _lifecycle };
        }
        using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/api/shared/register");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);
        request.Content = new StringContent(JsonSerializer.Serialize(new { profilePath = _profile, hostEpoch = epoch, bootstrap, process = CurrentProcessIdentity() }), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var reason = "Shared host rejected attachment with HTTP " + (int)response.StatusCode;
            try
            {
                using var rejected = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
                if (rejected.RootElement.TryGetProperty("error", out var detail) && detail.ValueKind == JsonValueKind.String)
                    reason += ": " + detail.GetString();
            }
            catch (JsonException) { }
            throw new InvalidOperationException(reason);
        }
        _epoch = epoch;
        _bootstrapRegistered = true;
        ReadyUri = new Uri($"http://127.0.0.1:{port}/#{control.GetProperty("browserCredential").GetString()}");
        Ready?.Invoke(ReadyUri);
    }

    private static object CurrentProcessIdentity()
    {
        using var process = Process.GetCurrentProcess();
        return new { pid = process.Id, startIdentity = process.StartTime.ToUniversalTime().ToString("O") };
    }

    private async Task Reconnect(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(2000, cancellationToken).ConfigureAwait(false);
                var control = SharedNativeHost.Read("control.json");
                if (control.GetProperty("desiredState").GetString() != "running") continue;
                var sameLiveHost = false;
                try
                {
                    var discovery = SharedNativeHost.Read("discovery.json");
                    if (discovery.GetProperty("hostEpoch").GetString() == _epoch)
                    {
                        using var process = Process.GetProcessById(discovery.GetProperty("pid").GetInt32());
                        sameLiveHost = !process.HasExited && process.StartTime.ToUniversalTime().Ticks == _hostProcessStartTicks;
                    }
                }
                catch { /* Missing discovery or an exited PID needs singleton discovery/replacement. */ }
                if (sameLiveHost) continue;
                await _recovery.EnsureAsync(false, false, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception error) { _status.UpdateError(RuntimeStatusComponent.Host, new RuntimeErrorV2 { Code = RpcReasonCode.HANDSHAKE_REJECTED, Message = "Shared host reconnect: " + error.Message }); }
        }
    }

    public async Task<bool> Detach(CancellationToken cancellationToken)
    {
        _lifetime?.Cancel(); _attached = false;
        try
        {
            var discovery = SharedNativeHost.Read("discovery.json");
            using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{discovery.GetProperty("endpointPort").GetInt32()}/api/shared/register");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", discovery.GetProperty("registrationToken").GetString());
            request.Content = new StringContent(JsonSerializer.Serialize(new { action = "detach", lifecycleInstanceId = _lifecycle, hostEpoch = _epoch }), Encoding.UTF8, "application/json");
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch { return true; } // Local transport shutdown fences this attachment even when Node is unavailable.
    }
    public void StopLocal() { _lifetime?.Cancel(); _attached = false; }
    public void Dispose() { StopLocal(); _lifetime?.Dispose(); _http.Dispose(); }
}
