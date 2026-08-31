using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace rhino_zmq_poc
{
    internal sealed class HopperHostStatus
    {
        public string State { get; init; }
        public int? ProcessId { get; init; }
        public string Origin { get; init; }
        public string LastError { get; init; }
        public bool? Healthy { get; init; }
    }

    internal readonly struct HopperHostStartResult
    {
        public HopperHostStartResult(bool accepted, string message)
        {
            Accepted = accepted;
            Message = message;
        }

        public bool Accepted { get; }
        public string Message { get; }
    }

    internal sealed class HopperHostManager : IDisposable
    {
        private sealed class RuntimeManifest
        {
            [JsonPropertyName("protocolVersion")]
            public int ProtocolVersion { get; set; }

            [JsonPropertyName("nodeExecutable")]
            public string NodeExecutable { get; set; }

            [JsonPropertyName("nodeExecutables")]
            public Dictionary<string, string> NodeExecutables { get; set; }

            [JsonPropertyName("hostEntry")]
            public string HostEntry { get; set; }
        }

        private static readonly TimeSpan ReadinessTimeout = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan HealthInterval = TimeSpan.FromSeconds(5);
        private readonly object _lock = new object();
        private readonly string _pluginDirectory;
        private readonly IBrowserLauncher _browser;
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        private Process _process;
        private Timer _readinessTimer;
        private Timer _healthTimer;
        private Uri _url;
        private string _backendInstanceId = "";
        private string _state = "stopped";
        private string _lastError = "";
        private bool? _healthy;
        private int _healthCheckRunning;
        private bool _disposed;

        public HopperHostManager(string pluginDirectory, IBrowserLauncher browser)
        {
            _pluginDirectory = pluginDirectory ?? throw new ArgumentNullException(nameof(pluginDirectory));
            _browser = browser ?? throw new ArgumentNullException(nameof(browser));
        }

        public HopperHostStartResult StartOrOpen(HopperBackendStatus backend)
        {
            if (backend == null || !backend.IsRunning || string.IsNullOrWhiteSpace(backend.ProfilePath))
                return new HopperHostStartResult(false, "Hopper backend is not ready.");

            lock (_lock)
            {
                if (_disposed)
                    return new HopperHostStartResult(false, "Hopper host manager is shutting down.");

                if (_process != null &&
                    !_process.HasExited &&
                    string.Equals(_backendInstanceId, backend.InstanceId, StringComparison.Ordinal))
                {
                    if (_url != null)
                    {
                        try
                        {
                            _browser.Open(_url);
                            return new HopperHostStartResult(true, "Hopper is already running. Opened its browser UI.");
                        }
                        catch (Exception ex)
                        {
                            _lastError = $"Could not open browser: {ex.Message}";
                            return new HopperHostStartResult(false, _lastError);
                        }
                    }
                    return new HopperHostStartResult(true, "Hopper host is starting.");
                }

                DisposeProcessLocked();
                if (!TryResolveLaunch(out var executable, out var hostEntry, out var error))
                {
                    _state = "faulted";
                    _lastError = error;
                    return new HopperHostStartResult(false, error);
                }

                var startInfo = new ProcessStartInfo(executable)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(hostEntry) ?? _pluginDirectory,
                };
                startInfo.ArgumentList.Add(hostEntry);
                startInfo.ArgumentList.Add("--connection-profile");
                startInfo.ArgumentList.Add(Path.GetFullPath(backend.ProfilePath));
                startInfo.ArgumentList.Add("--parent-pid");
                startInfo.ArgumentList.Add(Environment.ProcessId.ToString());
                startInfo.ArgumentList.Add("--port");
                startInfo.ArgumentList.Add("0");
                startInfo.ArgumentList.Add("--data-dir");
                startInfo.ArgumentList.Add(HostDataDirectory());
                startInfo.ArgumentList.Add("--instance-id");
                startInfo.ArgumentList.Add($"{Environment.ProcessId}-{backend.InstanceId}");

                var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
                process.OutputDataReceived += OnOutput;
                process.ErrorDataReceived += OnError;
                process.Exited += OnExited;

                try
                {
                    // Assign ownership before Start so an immediately exiting child
                    // cannot beat the Exited handler's identity check.
                    _process = process;
                    _backendInstanceId = backend.InstanceId;
                    if (!process.Start())
                        throw new InvalidOperationException("Process.Start returned false");
                    _url = null;
                    _state = "starting";
                    _lastError = "";
                    _healthy = null;
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    _readinessTimer = new Timer(OnReadinessTimeout, process, ReadinessTimeout, Timeout.InfiniteTimeSpan);
                    return new HopperHostStartResult(true, "Hopper host is starting. The browser will open when it is ready.");
                }
                catch (Exception ex)
                {
                    if (ReferenceEquals(_process, process))
                        _process = null;
                    _backendInstanceId = "";
                    process.OutputDataReceived -= OnOutput;
                    process.ErrorDataReceived -= OnError;
                    process.Exited -= OnExited;
                    process.Dispose();
                    _state = "faulted";
                    _lastError = ex.Message;
                    return new HopperHostStartResult(false, $"Could not start Hopper host: {ex.Message}");
                }
            }
        }

        public HopperHostStatus GetStatus()
        {
            lock (_lock)
            {
                var processId = _process != null && !_process.HasExited ? _process.Id : (int?)null;
                return new HopperHostStatus
                {
                    State = _state,
                    ProcessId = processId,
                    Origin = _url?.GetLeftPart(UriPartial.Authority) ?? "",
                    LastError = _lastError,
                    Healthy = _healthy,
                };
            }
        }

        private void OnOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null || sender is not Process process)
                return;
            if (!HostReadiness.TryParse(e.Data, process.Id, out var readyUrl))
                return;

            lock (_lock)
            {
                if (_disposed || !ReferenceEquals(_process, process) || process.HasExited)
                    return;
                _url = readyUrl;
                _state = "ready";
                _lastError = "";
                _readinessTimer?.Dispose();
                _readinessTimer = null;
                _healthTimer?.Dispose();
                _healthTimer = new Timer(OnHealthTimer, process, TimeSpan.Zero, HealthInterval);
            }

            try { _browser.Open(readyUrl); }
            catch (Exception ex) { SetError($"Could not open browser: {ex.Message}", keepReady: true); }
        }

        private void OnError(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(e.Data) || sender is not Process process)
                return;
            lock (_lock)
            {
                if (_disposed || !ReferenceEquals(_process, process))
                    return;
                _lastError = e.Data;
                if (_url == null)
                    _state = "faulted";
            }
        }

        private void OnExited(object sender, EventArgs e)
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_process, sender))
                    return;
                if (_disposed)
                    _state = "stopped";
                else if (!string.Equals(_state, "faulted", StringComparison.Ordinal))
                    _state = "exited";
                _healthy = false;
                _readinessTimer?.Dispose();
                _readinessTimer = null;
                _healthTimer?.Dispose();
                _healthTimer = null;
            }
        }

        private void OnReadinessTimeout(object state)
        {
            if (state is not Process process)
                return;
            var shouldKill = false;
            lock (_lock)
            {
                if (!ReferenceEquals(_process, process) || _url != null || process.HasExited)
                    return;
                _state = "faulted";
                _lastError = "Hopper host did not report readiness within 60 seconds.";
                shouldKill = true;
            }
            if (shouldKill)
                TryKill(process);
        }

        private void OnHealthTimer(object state)
        {
            if (state is not Process process)
                return;
            lock (_lock)
            {
                if (_disposed || !ReferenceEquals(_process, process) || process.HasExited)
                    return;
            }
            if (Interlocked.Exchange(ref _healthCheckRunning, 1) != 0)
                return;
            _ = CheckHealthAsync(process);
        }

        private async Task CheckHealthAsync(Process process)
        {
            try
            {
                Uri health;
                lock (_lock)
                {
                    if (_disposed || _url == null || !ReferenceEquals(_process, process))
                        return;
                    health = new Uri(_url.GetLeftPart(UriPartial.Authority) + "/health");
                }
                using var response = await _http.GetAsync(health).ConfigureAwait(false);
                lock (_lock)
                {
                    if (ReferenceEquals(_process, process))
                        _healthy = response.IsSuccessStatusCode;
                }
            }
            catch
            {
                lock (_lock)
                {
                    if (ReferenceEquals(_process, process))
                        _healthy = false;
                }
            }
            finally
            {
                Interlocked.Exchange(ref _healthCheckRunning, 0);
            }
        }

        private bool TryResolveLaunch(out string executable, out string hostEntry, out string error)
        {
            var explicitHost = ResolveExplicitFile("HOPPER_HOST_ENTRY");
            var explicitNode = ResolveExplicitFile("HOPPER_NODE_EXECUTABLE");
            var validManifest = TryReadRuntimeManifest(out var manifestNode, out var manifestHost, out var manifestFound);
            if (manifestFound && !validManifest && (explicitHost == null || explicitNode == null))
            {
                executable = null;
                hostEntry = null;
                error = "The bundled Hopper runtime manifest is invalid or points outside its package.";
                return false;
            }
            hostEntry = explicitHost
                ?? manifestHost
                ?? FindFromAncestors(Path.Combine("dist", "host", "index.js"));
            executable = explicitNode
                ?? manifestNode
                ?? FindBundledNode();

            if (hostEntry == null)
            {
                error = "Bundled Hopper host was not found (expected dist/host/index.js beside the package).";
                return false;
            }
            if (executable == null)
            {
                error = "Bundled Node runtime was not found. Hopper does not use the global node command.";
                return false;
            }
            error = "";
            return true;
        }

        private bool TryReadRuntimeManifest(out string executable, out string hostEntry, out bool manifestFound)
        {
            executable = null;
            hostEntry = null;
            var manifestPath = FindFromAncestors(Path.Combine("runtime", "hopper-runtime.json"));
            manifestFound = manifestPath != null;
            if (manifestPath == null)
                return false;

            try
            {
                var manifest = JsonSerializer.Deserialize<RuntimeManifest>(File.ReadAllText(manifestPath));
                if (manifest?.ProtocolVersion != 1)
                    return false;
                var manifestDirectory = Path.GetDirectoryName(manifestPath) ?? _pluginDirectory;
                var runtimeKey = RuntimeDirectoryName();
                var selectedNode = manifest.NodeExecutables != null &&
                    manifest.NodeExecutables.TryGetValue(runtimeKey, out var architectureNode)
                        ? architectureNode
                        : manifest.NodeExecutable;
                executable = RuntimeManifestPaths.ResolveFile(selectedNode, manifestDirectory);
                hostEntry = RuntimeManifestPaths.ResolveFile(manifest.HostEntry, manifestDirectory);
                return executable != null && hostEntry != null;
            }
            catch (Exception ex)
            {
                SetError($"Could not read Hopper runtime manifest: {ex.Message}", keepReady: false);
                executable = null;
                hostEntry = null;
                return false;
            }
        }

        private string FindBundledNode()
        {
            var candidates = OperatingSystem.IsWindows()
                ? new[]
                {
                    Path.Combine("runtime", "node", "node.exe"),
                    Path.Combine("runtime", RuntimeDirectoryName(), "node.exe"),
                }
                : new[]
                {
                    Path.Combine("runtime", "node", "bin", "node"),
                    Path.Combine("runtime", "node", "node"),
                    Path.Combine("runtime", RuntimeDirectoryName(), "bin", "node"),
                    Path.Combine("runtime", RuntimeDirectoryName(), "node"),
                };

            foreach (var candidate in candidates)
            {
                var found = FindFromAncestors(candidate);
                if (found != null)
                    return found;
            }
            return null;
        }

        private static string RuntimeDirectoryName()
        {
            var architecture = RuntimeInformation.ProcessArchitecture == Architecture.Arm64
                ? "arm64"
                : "x64";
            if (OperatingSystem.IsWindows())
                return $"win-{architecture}";
            if (OperatingSystem.IsMacOS())
                return $"osx-{architecture}";
            return $"linux-{architecture}";
        }

        private string FindFromAncestors(string relativePath)
        {
            var current = new DirectoryInfo(_pluginDirectory);
            for (var depth = 0; current != null && depth < 8; depth++, current = current.Parent)
            {
                var candidate = Path.Combine(current.FullName, relativePath);
                if (File.Exists(candidate))
                    return Path.GetFullPath(candidate);
            }
            return null;
        }

        private static string ResolveExplicitFile(string environmentVariable)
        {
            var value = Environment.GetEnvironmentVariable(environmentVariable);
            if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
                return null;
            var path = Path.GetFullPath(value);
            return File.Exists(path) ? path : null;
        }

        private static string HostDataDirectory()
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "hopper-pi",
                "host");
            Directory.CreateDirectory(path);
            return path;
        }

        private void SetError(string error, bool keepReady)
        {
            lock (_lock)
            {
                _lastError = error ?? "";
                if (!keepReady || _url == null)
                    _state = "faulted";
            }
        }

        private static void TryKill(Process process)
        {
            try
            {
                if (!process.HasExited)
                    process.Kill(entireProcessTree: true);
            }
            catch
            {
            }
        }

        private void TryGracefulShutdown(Process process)
        {
            if (_url == null || process.HasExited)
                return;
            try
            {
                var token = _url.Fragment.TrimStart('#');
                if (string.IsNullOrEmpty(token))
                    return;
                using var request = new HttpRequestMessage(
                    HttpMethod.Post,
                    new Uri(_url.GetLeftPart(UriPartial.Authority) + "/api/shutdown"));
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
                using var response = _http.Send(request, HttpCompletionOption.ResponseHeadersRead);
                if (response.IsSuccessStatusCode)
                    process.WaitForExit(6000);
            }
            catch
            {
                // A bounded force-kill below remains the final fallback.
            }
        }

        private void DisposeProcessLocked()
        {
            _readinessTimer?.Dispose();
            _readinessTimer = null;
            _healthTimer?.Dispose();
            _healthTimer = null;
            if (_process != null)
            {
                TryGracefulShutdown(_process);
                _process.OutputDataReceived -= OnOutput;
                _process.ErrorDataReceived -= OnError;
                _process.Exited -= OnExited;
                TryKill(_process);
                try { _process.WaitForExit(2000); } catch { }
                _process.Dispose();
                _process = null;
            }
            _url = null;
            _backendInstanceId = "";
        }

        public void Dispose()
        {
            lock (_lock)
            {
                if (_disposed)
                    return;
                _disposed = true;
                DisposeProcessLocked();
                _state = "stopped";
                _healthy = null;
            }
            _http.Dispose();
        }
    }
}
