using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    public sealed class HopperBackendStatus
    {
        public bool IsRunning { get; init; }
        public bool PublishEnabled { get; init; }
        public string InstanceId { get; init; }
        public string PubEndpoint { get; init; }
        public string PushEndpoint { get; init; }
        public string ReqEndpoint { get; init; }
        public string ProfilePath { get; init; }
        public string ActiveGrasshopperDocument { get; init; }
        public string LastJobReceived { get; init; }
        public string LastXmlSent { get; init; }
        public string DebugLog { get; init; }
        public string LastError { get; init; }
    }

    /// <summary>
    /// Process-wide owner of the ZMQ bridge. Rhino commands and the legacy GHZMQ
    /// component both use this runtime, but neither document objects nor component
    /// lifetimes own it.
    /// </summary>
    public sealed class HopperBackendRuntime : IDisposable
    {
        private const int MaxLogLength = 8000;
        private static readonly Lazy<HopperBackendRuntime> LazyShared =
            new Lazy<HopperBackendRuntime>(() => new HopperBackendRuntime());
        private static readonly HashSet<string> RhinoOnlyCommandActions =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "beginRhinoAgentTransaction",
                "commitRhinoAgentTransaction",
                "cancelRhinoAgentTransaction",
            };

        private readonly object _lifecycleLock = new object();
        private readonly object _stateLock = new object();
        private readonly Dictionary<Guid, bool> _legacyPublishPreferences = new Dictionary<Guid, bool>();
        private ZMqService _zmqService;
        private JobQueue _jobQueue;
        private DocumentMonitor _docMonitor;
        private ActiveGrasshopperDocumentTracker _docTracker;
        private XmlPublisher _xmlPublisher;
        private CommandExecutor _commandExecutor;
        private string _debugLog = "";
        private string _lastJobReceived = "";
        private string _lastXmlSent = "";
        private string _lastError = "";
        private bool _publishEnabled = true;
        private bool _closingSubscribed;
        private bool _disposed;

        private HopperBackendRuntime()
        {
        }

        public static HopperBackendRuntime Shared => LazyShared.Value;

        public event Action Changed;

        public bool PublishEnabled
        {
            get
            {
                lock (_stateLock) return _publishEnabled;
            }
            set
            {
                lock (_stateLock)
                {
                    if (_publishEnabled == value)
                        return;
                    _publishEnabled = value;
                }
                RaiseChanged();
            }
        }

        public void SetLegacyPublishPreference(Guid componentId, bool enabled)
        {
            var changed = false;
            lock (_stateLock)
            {
                _legacyPublishPreferences[componentId] = enabled;
                var publishEnabled = _legacyPublishPreferences.Count == 0 ||
                    _legacyPublishPreferences.Values.Any(value => value);
                if (_publishEnabled != publishEnabled)
                {
                    _publishEnabled = publishEnabled;
                    changed = true;
                }
            }
            if (changed)
                RaiseChanged();
        }

        public void RemoveLegacyPublishPreference(Guid componentId)
        {
            var changed = false;
            lock (_stateLock)
            {
                if (!_legacyPublishPreferences.Remove(componentId))
                    return;
                var publishEnabled = _legacyPublishPreferences.Count == 0 ||
                    _legacyPublishPreferences.Values.Any(value => value);
                if (_publishEnabled != publishEnabled)
                {
                    _publishEnabled = publishEnabled;
                    changed = true;
                }
            }
            if (changed)
                RaiseChanged();
        }

        public bool StartBackend()
        {
            lock (_lifecycleLock)
            {
                if (_zmqService?.IsRunning == true)
                    return true;

                CleanupCore();
                _disposed = false;
                SetInitialLog();

                try
                {
                    _commandExecutor = new CommandExecutor(AppendLog);
                    _jobQueue = new JobQueue(ExecuteCommand);
                    _zmqService = new ZMqService(_jobQueue, ResolveActiveDocument);
                    _xmlPublisher = new XmlPublisher(_zmqService.PublishXmlEvent);
                    _docMonitor = new DocumentMonitor();
                    _docTracker = new ActiveGrasshopperDocumentTracker(_docMonitor);

                    _zmqService.OnDebugLog += OnZmqDebugLog;
                    _zmqService.OnJobStatus += OnJobStatus;
                    _zmqService.OnJobReceived += OnJobReceived;
                    _docMonitor.OnSolutionEnd += OnSolutionEnd;

                    _zmqService.Start();
                    if (!_zmqService.IsRunning)
                    {
                        SetError("ZMQ failed to bind a loopback endpoint");
                        CleanupCore();
                        return false;
                    }

                    _jobQueue.Start();
                    _docTracker.Start();
                    SubscribeClosing();
                    RhinoCodeRunner.ScheduleWarmup("python", "csharp");

                    var profile = _zmqService.Profile;
                    AppendLog($"ZMQ started: PUB @ {profile?.PubEndpoint}, PULL @ {profile?.PushEndpoint}, REP @ {profile?.ReqEndpoint}");
                    AppendLog($"Connection profile: {_zmqService.ProfilePath}");
                    RaiseChanged();
                    return true;
                }
                catch (Exception ex)
                {
                    SetError(ex.Message);
                    CleanupCore();
                    return false;
                }
            }
        }

        public void StopBackend()
        {
            lock (_lifecycleLock)
            {
                if (_disposed)
                    return;

                _disposed = true;
                CleanupCore();
                UnsubscribeClosing();
                RaiseChanged();
            }
        }

        public HopperBackendStatus GetStatus()
        {
            ConnectionProfile profile;
            string profilePath;
            bool running;
            lock (_lifecycleLock)
            {
                profile = _zmqService?.Profile;
                profilePath = _zmqService?.ProfilePath ?? "";
                running = _zmqService?.IsRunning == true;
            }

            var activeDocument = SafeActiveDocumentName();
            lock (_stateLock)
            {
                return new HopperBackendStatus
                {
                    IsRunning = running,
                    PublishEnabled = _publishEnabled,
                    InstanceId = profile?.InstanceId ?? "",
                    PubEndpoint = profile?.PubEndpoint ?? "",
                    PushEndpoint = profile?.PushEndpoint ?? "",
                    ReqEndpoint = profile?.ReqEndpoint ?? "",
                    ProfilePath = profilePath,
                    ActiveGrasshopperDocument = activeDocument,
                    LastJobReceived = _lastJobReceived,
                    LastXmlSent = _lastXmlSent,
                    DebugLog = _debugLog,
                    LastError = _lastError,
                };
            }
        }

        private string ExecuteCommand(GhCommand command)
        {
            var action = command?.Action ?? "command";
            var doc = ResolveActiveDocument();
            if (doc == null && !RhinoOnlyCommandActions.Contains(action))
                return $"{action} error: no active Grasshopper document";

            return _commandExecutor?.Execute(doc, command) ?? "command error: backend is not ready";
        }

        private static GH_Document ResolveActiveDocument()
        {
            return Grasshopper.Instances.ActiveCanvas?.Document;
        }

        private static string SafeActiveDocumentName()
        {
            try
            {
                return Utilities.RunOnUiThread(() =>
                {
                    var doc = ResolveActiveDocument();
                    return doc?.FilePath ?? (doc == null ? "" : "Untitled");
                }, TimeSpan.FromSeconds(2));
            }
            catch
            {
                return "";
            }
        }

        private void OnZmqDebugLog(string message) => AppendLog(message);

        private void OnJobStatus(GhJobStatus status)
        {
            AppendLog($"Job {status.JobId}: {status.State}");
            RaiseChanged();
        }

        private void OnJobReceived(string value)
        {
            lock (_stateLock) _lastJobReceived = value ?? "";
            RaiseChanged();
        }

        private void OnSolutionEnd(GH_Document doc)
        {
            bool publish;
            lock (_stateLock) publish = _publishEnabled;
            if (!publish || _xmlPublisher == null)
                return;

            var xml = _xmlPublisher.Publish(doc);
            if (xml == null)
                return;

            lock (_stateLock) _lastXmlSent = xml;
            AppendLog($"Sending XML: {xml.Length} chars, topic=gh.event.xml");
            RaiseChanged();
        }

        private void SetInitialLog()
        {
            lock (_stateLock)
            {
                _debugLog = $"[{DateTime.Now:HH:mm:ss}] Initializing ZMQ...\n";
                _lastError = "";
            }
        }

        private void AppendLog(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
                return;

            lock (_stateLock)
            {
                _debugLog += $"[{DateTime.Now:HH:mm:ss}] {message.TrimEnd()}\n";
                if (_debugLog.Length > MaxLogLength)
                    _debugLog = _debugLog.Substring(_debugLog.Length - MaxLogLength);
            }
            RaiseChanged();
        }

        private void SetError(string message)
        {
            lock (_stateLock) _lastError = message ?? "";
            AppendLog($"Backend error: {message}");
        }

        private void CleanupCore()
        {
            if (_zmqService != null)
            {
                _zmqService.OnDebugLog -= OnZmqDebugLog;
                _zmqService.OnJobStatus -= OnJobStatus;
                _zmqService.OnJobReceived -= OnJobReceived;
            }
            if (_docMonitor != null)
                _docMonitor.OnSolutionEnd -= OnSolutionEnd;

            _docTracker?.Dispose();
            _docMonitor?.Dispose();
            _zmqService?.Dispose();
            _jobQueue?.Dispose();

            _docTracker = null;
            _docMonitor = null;
            _zmqService = null;
            _jobQueue = null;
            _xmlPublisher = null;
            _commandExecutor = null;
        }

        private void SubscribeClosing()
        {
            if (_closingSubscribed)
                return;
            RhinoApp.Closing += OnRhinoClosing;
            _closingSubscribed = true;
        }

        private void UnsubscribeClosing()
        {
            if (!_closingSubscribed)
                return;
            RhinoApp.Closing -= OnRhinoClosing;
            _closingSubscribed = false;
        }

        private void OnRhinoClosing(object sender, EventArgs e) => StopBackend();

        private void RaiseChanged()
        {
            try { Changed?.Invoke(); } catch { }
        }

        public void Dispose() => StopBackend();
    }
}
