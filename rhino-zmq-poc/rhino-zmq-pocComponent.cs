using System;
using System.Drawing;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    public class rhino_zmq_pocComponent : GH_Component
    {
        private ZMqService _zmqService;
        private JobQueue _jobQueue;
        private DocumentMonitor _docMonitor;
        private XmlPublisher _xmlPublisher;
        private CommandExecutor _cmdExecutor;

        private const int MaxLogLength = 8000;
        private string _debugLog = "";
        private string _lastJobReceived = "";
        private string _lastXmlSent = "";
        private bool _publishEnabled = true;
        private readonly object _logLock = new object();

        private Action<string> _zmqDebugLogHandler;
        private Action<GhJobStatus> _zmqJobStatusHandler;
        private Action<string> _zmqJobReceivedHandler;
        private Action<GH_Document> _docMonitorSolutionEndHandler;

        private static readonly object _instanceLock = new object();
        private static rhino_zmq_pocComponent _activeInstance;
        private bool _isOwner;

        public rhino_zmq_pocComponent()
            : base("GH ZMQ Plugin", "GHZMQ",
                "CLI-GH Connector: ZMQ pub/sub and command execution",
                "CLI-GH", "Commands")
        {
        }

        public override void AddedToDocument(GH_Document doc)
        {
            base.AddedToDocument(doc);
            lock (_instanceLock)
            {
                if (_activeInstance != null && _activeInstance != this)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        "Another GHZMQ instance is already active. This component is inactive.");
                    return;
                }
                _activeInstance = this;
                _isOwner = true;
            }
        }

        protected override void RegisterInputParams(GH_Component.GH_InputParamManager pManager)
        {
            pManager.AddBooleanParameter("Enable Pub", "PUB", "Enable/disable XML publishing on solution end", GH_ParamAccess.item, true);
        }

        protected override void RegisterOutputParams(GH_Component.GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Debug Log", "LOG", "ZMQ debug output", GH_ParamAccess.list);
            pManager.AddTextParameter("Job Received", "JOB", "Last received job (jobId|commandId|action)", GH_ParamAccess.item);
            pManager.AddTextParameter("Last XML", "XML", "Last published XML snapshot", GH_ParamAccess.item);
        }

        protected override void BeforeSolveInstance()
        {
            EnsureSingletonOwnership();
            if (!_isOwner) return;
            if (_zmqService == null)
            {
                InitializeZmq();
            }
            _docMonitor.EnsureSubscription(OnPingDocument());
        }

        private void EnsureSingletonOwnership()
        {
            if (_isOwner) return;

            lock (_instanceLock)
            {
                if (_activeInstance != null && _activeInstance != this)
                    return;
                _activeInstance = this;
                _isOwner = true;
            }
        }

        private void InitializeZmq()
        {
            lock (_logLock) { _debugLog = $"[{DateTime.Now:HH:mm:ss}] Initializing ZMQ...\n"; }
            _jobQueue = new JobQueue();
            _zmqService = new ZMqService(_jobQueue, OnPingDocument());
            _xmlPublisher = new XmlPublisher(_zmqService.PublishXmlEvent);
            _cmdExecutor = new CommandExecutor(msg => AppendLog($"[{DateTime.Now:HH:mm:ss}] {msg}\n"));

            _zmqDebugLogHandler = msg => AppendLog($"[{DateTime.Now:HH:mm:ss}] {msg}\n");
            _zmqJobStatusHandler = status => AppendLog($"[{DateTime.Now:HH:mm:ss}] Job {status.JobId}: {status.State}\n");
            _zmqJobReceivedHandler = info =>
            {
                _lastJobReceived = info;
                ScheduleExpire();
            };

            _zmqService.OnDebugLog += _zmqDebugLogHandler;
            _zmqService.OnJobStatus += _zmqJobStatusHandler;
            _zmqService.OnJobReceived += _zmqJobReceivedHandler;

            _docMonitor = new DocumentMonitor();
            _docMonitorSolutionEndHandler = doc =>
            {
                if (!_publishEnabled) return;
                _lastXmlSent = _xmlPublisher.Publish(doc);
                if (_lastXmlSent != null)
                    AppendLog($"[{DateTime.Now:HH:mm:ss}] Sending XML: {_lastXmlSent.Length} chars, topic=gh.event.xml\n");
            };
            _docMonitor.OnSolutionEnd += _docMonitorSolutionEndHandler;

            _zmqService.Start();
            _jobQueue.Start();
            RhinoZmqPlugin.Instance.Component = this;
            AppendLog($"[{DateTime.Now:HH:mm:ss}] ZMQ started: PUB @ 5555, ROUTER @ 5556\n");
        }

        private void ScheduleExpire()
        {
            RhinoApp.Idle += OnIdleExpire;
        }

        private void AppendLog(string msg)
        {
            lock (_logLock)
            {
                _debugLog += msg;
                if (_debugLog.Length > MaxLogLength)
                    _debugLog = _debugLog.Substring(_debugLog.Length - MaxLogLength);
            }
        }

        private void OnIdleExpire(object sender, EventArgs e)
        {
            RhinoApp.Idle -= OnIdleExpire;
            ExpireSolution(true);
        }

        public string ExecuteCommand(GhCommand command) => _cmdExecutor?.Execute(OnPingDocument(), command);

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            if (!_isOwner)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Another GHZMQ instance is already active. This component is inactive.");
                DA.SetData(1, "Inactive — another GHZMQ component is active");
                return;
            }

            DA.GetData(0, ref _publishEnabled);
            string logSnapshot;
            lock (_logLock) { logSnapshot = _debugLog; }
            var logLines = logSnapshot.Split('\n').Where(l => !string.IsNullOrEmpty(l)).ToArray();
            DA.SetDataList(0, logLines);
            DA.SetData(1, _lastJobReceived);
            DA.SetData(2, _lastXmlSent);
        }

        public override GH_Exposure Exposure => GH_Exposure.primary;

        protected override Bitmap Icon => null;

        public override Guid ComponentGuid => new Guid("e07753b1-fdec-417a-b57a-83a95204a8dd");

        public override void RemovedFromDocument(GH_Document doc)
        {
            if (_isOwner)
            {
                Cleanup();
                lock (_instanceLock)
                {
                    if (_activeInstance == this)
                        _activeInstance = null;
                    TryPromoteNewInstance(doc);
                }
            }
            base.RemovedFromDocument(doc);
        }

        private void Cleanup()
        {
            if (_zmqService != null)
            {
                if (_zmqDebugLogHandler != null) _zmqService.OnDebugLog -= _zmqDebugLogHandler;
                if (_zmqJobStatusHandler != null) _zmqService.OnJobStatus -= _zmqJobStatusHandler;
                if (_zmqJobReceivedHandler != null) _zmqService.OnJobReceived -= _zmqJobReceivedHandler;
                _zmqService.Dispose();
            }
            if (_docMonitor != null)
            {
                if (_docMonitorSolutionEndHandler != null)
                    _docMonitor.OnSolutionEnd -= _docMonitorSolutionEndHandler;
                _docMonitor.Dispose();
            }
            _jobQueue?.Dispose();

            _zmqService = null;
            _jobQueue = null;
            _docMonitor = null;
            _xmlPublisher = null;
            _cmdExecutor = null;
            _zmqDebugLogHandler = null;
            _zmqJobStatusHandler = null;
            _zmqJobReceivedHandler = null;
            _docMonitorSolutionEndHandler = null;
            _isOwner = false;

            if (RhinoZmqPlugin.Instance.Component == this)
                RhinoZmqPlugin.Instance.Component = null;
        }

        private void TryPromoteNewInstance(GH_Document doc)
        {
            if (doc == null) return;
            foreach (var obj in doc.Objects)
            {
                if (obj is rhino_zmq_pocComponent comp && comp != this)
                {
                    _activeInstance = comp;
                    comp._isOwner = true;
                    comp.ClearRuntimeMessages();
                    comp.ExpireSolution(true);
                    break;
                }
            }
        }
    }
}
