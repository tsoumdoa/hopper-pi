using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core;
using Hopper.Core.Lifecycle;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;

namespace rhino_zmq_poc
{
    internal sealed class RhinoInstanceProfileStore : IInstanceProfileStore
    {
        private readonly object _gate = new object();
        private readonly InstanceProfileStore _store;
        private readonly IInstanceProfileFileSystem _files;
        private readonly string _profilesDirectory;
        private readonly string _compatibilityPointer;
        private readonly int _ownerProcessId;
        private readonly DateTimeOffset _ownerProcessStartedAt;
        private readonly Dictionary<string, string> _ownedPaths = new Dictionary<string, string>();

        public RhinoInstanceProfileStore(
            IInstanceProfileFileSystem files,
            IAtomicWritePathProvider temporaryPaths,
            string applicationDataDirectory)
        {
            _files = files ?? throw new ArgumentNullException(nameof(files));
            _store = new InstanceProfileStore(files, temporaryPaths);
            if (string.IsNullOrWhiteSpace(applicationDataDirectory))
                throw new ArgumentException("Application data directory is required.", nameof(applicationDataDirectory));
            _profilesDirectory = Path.Combine(applicationDataDirectory, "runtime", "profiles");
            _compatibilityPointer = Path.Combine(applicationDataDirectory, "connection.json");
            using var process = Process.GetCurrentProcess();
            _ownerProcessId = process.Id;
            _ownerProcessStartedAt = process.StartTime.ToUniversalTime();
        }

        public Task<ProfileWriteResult> WriteAsync(
            string lifecycleInstanceId,
            LifecycleTransportConnection connection,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RequireIdentifier(lifecycleInstanceId);
            var path = Path.Combine(_profilesDirectory, $"{lifecycleInstanceId}.json");
            try
            {
                var result = _store.Write(
                    new InstanceConnectionProfile(
                        RpcV2Contract.ProtocolVersion,
                        _ownerProcessId,
                        _ownerProcessStartedAt,
                        lifecycleInstanceId,
                        DateTimeOffset.UtcNow,
                        new InstanceProfileEndpoints(
                            connection.RouterEndpoint,
                            connection.PublisherEndpoint),
                        new InstanceProfileAuthentication(connection.AuthenticationToken)),
                    path,
                    _compatibilityPointer);
                lock (_gate)
                    _ownedPaths[lifecycleInstanceId] = path;
                return Task.FromResult(new ProfileWriteResult(
                    true,
                    true,
                    path,
                    result.CompatibilityPointerError ?? ""));
            }
            catch (Exception exception)
            {
                return Task.FromResult(new ProfileWriteResult(false, false, null, exception.Message));
            }
        }

        public Task<LifecycleActionResult> DeleteOwnedAsync(
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string path;
            lock (_gate)
            {
                if (!_ownedPaths.TryGetValue(lifecycleInstanceId, out path))
                    return Task.FromResult(LifecycleActionResult.Success());
            }
            try
            {
                _files.DeleteFile(path);
                lock (_gate)
                    _ownedPaths.Remove(lifecycleInstanceId);
                return Task.FromResult(LifecycleActionResult.Success());
            }
            catch (Exception exception)
            {
                return Task.FromResult(LifecycleActionResult.Failure(
                    $"Could not delete owned instance profile: {exception.Message}"));
            }
        }

        private static void RequireIdentifier(string value)
        {
            if (string.IsNullOrWhiteSpace(value)
                || value.Length > 128
                || Array.Exists(value.ToCharArray(), character =>
                    !(char.IsLetterOrDigit(character) || character == '-' || character == '_')))
            {
                throw new ArgumentException("Lifecycle instance ID is invalid.", nameof(value));
            }
        }
    }

    internal sealed class HopperHostEntryResolver
    {
        private readonly string _pluginDirectory;

        public HopperHostEntryResolver(string pluginDirectory)
        {
            _pluginDirectory = pluginDirectory ?? throw new ArgumentNullException(nameof(pluginDirectory));
        }

        public string Resolve()
        {
            var configured = Environment.GetEnvironmentVariable("HOPPER_HOST_ENTRY");
            if (!string.IsNullOrWhiteSpace(configured)
                && Path.IsPathFullyQualified(configured)
                && File.Exists(configured))
            {
                return Path.GetFullPath(configured);
            }

            var manifestPath = Path.Combine(_pluginDirectory, "runtime", "hopper-runtime.json");
            var fromManifest = RuntimeManifestPaths.ResolveHostEntry(manifestPath);
            if (fromManifest != null)
                return fromManifest;

            var packaged = Path.Combine(_pluginDirectory, "dist", "host", "index.js");
            return File.Exists(packaged) ? packaged : null;
        }
    }

    internal sealed class ManagedNodeChildProcess : IManagedChildProcess, IDisposable
    {
        private readonly object _gate = new object();
        private readonly HopperHostEntryResolver _hostEntry;
        private readonly string _dataDirectory;
        private readonly RuntimeStatusStore _status;
        private readonly HttpClient _http = new HttpClient();
        private Process _process;
        private DateTime _startedAt;
        private Uri _readyUri;
        private string _lifecycleInstanceId;
        private bool _intentionalStop;

        public ManagedNodeChildProcess(
            HopperHostEntryResolver hostEntry,
            string dataDirectory,
            RuntimeStatusStore status)
        {
            _hostEntry = hostEntry ?? throw new ArgumentNullException(nameof(hostEntry));
            _dataDirectory = dataDirectory ?? throw new ArgumentNullException(nameof(dataDirectory));
            _status = status ?? throw new ArgumentNullException(nameof(status));
        }

        public event Action<Uri> Ready;
        public event Action UnexpectedExit;

        public Uri ReadyUri
        {
            get
            {
                lock (_gate)
                    return _readyUri;
            }
        }

        public bool IsAlive
        {
            get
            {
                lock (_gate)
                    return _process != null && !SafeHasExited(_process);
            }
        }

        public Task<ChildStartResult> StartAsync(
            NodeRuntime runtime,
            string profilePath,
            string lifecycleInstanceId,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = _hostEntry.Resolve();
            if (string.IsNullOrWhiteSpace(entry))
            {
                return Task.FromResult(new ChildStartResult(
                    false, false, "The compiled Hopper host entry was not found."));
            }

            var info = new ProcessStartInfo(runtime.ExecutablePath)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(entry),
            };
            info.ArgumentList.Add(entry);
            AddArgument(info, "--connection-profile", Path.GetFullPath(profilePath));
            AddArgument(info, "--parent-pid", Environment.ProcessId.ToString());
            AddArgument(info, "--instance-id", lifecycleInstanceId);
            AddArgument(info, "--port", "0");
            AddArgument(info, "--data-dir", _dataDirectory);

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += OnOutput;
            process.ErrorDataReceived += OnError;
            process.Exited += OnExited;
            lock (_gate)
            {
                if (_process != null && !SafeHasExited(_process))
                {
                    process.Dispose();
                    return Task.FromResult(new ChildStartResult(
                        false, false, "A managed Node child is already running."));
                }
                _process?.Dispose();
                _process = process;
                _readyUri = null;
                _lifecycleInstanceId = lifecycleInstanceId;
                _intentionalStop = false;
            }

            try
            {
                if (!process.Start())
                    throw new InvalidOperationException("Process.Start returned false.");
                _startedAt = process.StartTime;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                _status.UpdateHost(new HostRuntimeStatusUpdate(
                    Hopper.Core.Lifecycle.LifecycleState.Starting,
                    process.Id,
                    runtime.ExecutablePath,
                    runtime.Version.ToString(),
                    HandshakeState.connecting,
                    0));
                return Task.FromResult(new ChildStartResult(true, true, ""));
            }
            catch (Exception exception)
            {
                lock (_gate)
                {
                    if (ReferenceEquals(_process, process))
                        _process = null;
                }
                process.Dispose();
                return Task.FromResult(new ChildStartResult(false, false, exception.Message));
            }
        }

        public async Task<bool> RequestGracefulStopAsync(
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            Process process;
            Uri ready;
            lock (_gate)
            {
                process = _process;
                ready = _readyUri;
                _intentionalStop = true;
            }
            if (process == null || SafeHasExited(process))
                return true;

            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(timeout);
            try
            {
                if (ready != null)
                {
                    var endpoint = new Uri(ready.GetLeftPart(UriPartial.Authority) + "/api/shutdown");
                    using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
                    request.Headers.Authorization = new AuthenticationHeaderValue(
                        "Bearer",
                        ready.Fragment.TrimStart('#'));
                    using var response = await _http.SendAsync(request, deadline.Token)
                        .ConfigureAwait(false);
                    if ((int)response.StatusCode is < 200 or >= 300)
                        return false;
                }
                await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
                return true;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return false;
            }
            catch
            {
                return false;
            }
        }

        public void KillVerifiedTreeNoWait()
        {
            Process process;
            DateTime startedAt;
            lock (_gate)
            {
                process = _process;
                startedAt = _startedAt;
                _intentionalStop = true;
            }
            if (process == null || SafeHasExited(process))
                return;
            try
            {
                if (process.StartTime == startedAt)
                    process.Kill(entireProcessTree: true);
            }
            catch
            {
            }
        }

        public async Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            Process process;
            lock (_gate)
                process = _process;
            if (process == null || SafeHasExited(process))
                return true;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(timeout);
            try
            {
                await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
                return true;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return false;
            }
        }

        public void Dispose()
        {
            KillVerifiedTreeNoWait();
            _http.Dispose();
        }

        private void OnOutput(object sender, DataReceivedEventArgs args)
        {
            if (args.Data == null || sender is not Process process)
                return;
            string lifecycleInstanceId;
            lock (_gate)
                lifecycleInstanceId = _lifecycleInstanceId;
            if (!HostReadiness.TryParse(args.Data, process.Id, lifecycleInstanceId, out var ready))
                return;
            lock (_gate)
            {
                if (!ReferenceEquals(_process, process) || SafeHasExited(process))
                    return;
                _readyUri = ready;
            }
            Ready?.Invoke(ready);
        }

        private void OnError(object sender, DataReceivedEventArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.Data))
                return;
            _status.UpdateError(RuntimeStatusComponent.Host, new RuntimeErrorV2
            {
                Code = RpcReasonCode.INTERNAL_ERROR,
                Message = args.Data,
            });
        }

        private void OnExited(object sender, EventArgs args)
        {
            var unexpected = false;
            lock (_gate)
            {
                if (!ReferenceEquals(_process, sender))
                    return;
                unexpected = !_intentionalStop;
            }
            if (unexpected)
                UnexpectedExit?.Invoke();
        }

        private static void AddArgument(ProcessStartInfo info, string name, string value)
        {
            info.ArgumentList.Add(name);
            info.ArgumentList.Add(value);
        }

        private static bool SafeHasExited(Process process)
        {
            try
            {
                return process.HasExited;
            }
            catch
            {
                return true;
            }
        }
    }
}
