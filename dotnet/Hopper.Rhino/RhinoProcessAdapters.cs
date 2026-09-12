using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core;
using Hopper.Core.Lifecycle;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Rhino.Host;

namespace rhino_zmq_poc
{
    internal sealed class RhinoInstanceProfileStore : IInstanceProfileStore
    {
        private readonly object _gate = new object();
        private readonly InstanceProfileStore _store;
        private readonly InstanceProfileDirectoryScanner _retention;
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
            _retention = new InstanceProfileDirectoryScanner(
                files,
                new SystemProcessIdentityInspector(),
                new SystemInstanceProfileClock(),
                temporaryPaths);
            if (string.IsNullOrWhiteSpace(applicationDataDirectory))
                throw new ArgumentException("Application data directory is required.", nameof(applicationDataDirectory));
            _profilesDirectory = Path.Combine(applicationDataDirectory, "runtime", "profiles");
            _compatibilityPointer = Path.Combine(applicationDataDirectory, "connection.json");
            using var process = Process.GetCurrentProcess();
            _ownerProcessId = process.Id;
            _ownerProcessStartedAt = process.StartTime.ToUniversalTime();
        }

        public InstanceProfileScanReport CleanupStaleProfiles() =>
            _retention.Scan(_profilesDirectory);

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

    /// <summary>Adapts lifecycle stop and exit to detaching this Rhino, never stopping the shared host.</summary>
    internal sealed class SharedHostProcessAdapter : IManagedChildProcess, IDisposable
    {
        private readonly SharedNodeAttachment _attachment;

        public SharedHostProcessAdapter(HopperHostEntryResolver hostEntry, RuntimeStatusStore status)
        {
            _attachment = new SharedNodeAttachment(
                hostEntry ?? throw new ArgumentNullException(nameof(hostEntry)),
                status ?? throw new ArgumentNullException(nameof(status)));
        }

        public event Action<Uri> Ready
        {
            add => _attachment.Ready += value;
            remove => _attachment.Ready -= value;
        }

        public Uri ReadyUri => _attachment.ReadyUri;
        public bool IsAlive => _attachment.IsAlive;
        public Task EnsureRunningAsync() => _attachment.EnsureRunningAsync();

        public Task<ChildStartResult> StartAsync(
            NodeRuntime runtime,
            string profilePath,
            string lifecycleInstanceId,
            CancellationToken cancellationToken) =>
            _attachment.StartAsync(runtime, profilePath, lifecycleInstanceId, cancellationToken);

        public async Task<bool> RequestGracefulStopAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(timeout);
            return await _attachment.Detach(deadline.Token).ConfigureAwait(false);
        }

        // IManagedChildProcess is the lifecycle contract. Its forced-stop operation only
        // stops this attachment; the independently owned Node process must survive.
        public void KillVerifiedTreeNoWait() => _attachment.StopLocal();
        public Task<bool> WaitForExitAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
            Task.FromResult(!_attachment.IsAlive);
        public void Dispose() => _attachment.Dispose();
    }
}
