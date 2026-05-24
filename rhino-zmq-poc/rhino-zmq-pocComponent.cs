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

        private string _debugLog = "";
        private string _lastJobReceived = "";
        private string _lastXmlSent = "";
        private bool _publishEnabled = true;
        private readonly object _logLock = new object();

        public rhino_zmq_pocComponent()
            : base("GH ZMQ Plugin", "GHZMQ",
                "CLI-GH Connector: ZMQ pub/sub and command execution",
                "CLI-GH", "Commands")
        {
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
            if (_zmqService == null)
            {
                InitializeZmq();
            }
            _docMonitor.EnsureSubscription(OnPingDocument());
        }

        private void InitializeZmq()
        {
            lock (_logLock) { _debugLog = $"[{DateTime.Now:HH:mm:ss}] Initializing ZMQ...\n"; }
            _jobQueue = new JobQueue();
            _zmqService = new ZMqService(_jobQueue, OnPingDocument());
            _xmlPublisher = new XmlPublisher(_zmqService.PublishXmlEvent);
            _cmdExecutor = new CommandExecutor(msg => AppendLog($"[{DateTime.Now:HH:mm:ss}] {msg}\n"));

            _zmqService.OnDebugLog += msg => AppendLog($"[{DateTime.Now:HH:mm:ss}] {msg}\n");
            _zmqService.OnJobStatus += status => AppendLog($"[{DateTime.Now:HH:mm:ss}] Job {status.JobId}: {status.State}\n");
            _zmqService.OnJobReceived += info =>
            {
                _lastJobReceived = info;
                ScheduleExpire();
            };

            _docMonitor = new DocumentMonitor();
            _docMonitor.OnSolutionEnd += doc =>
            {
                if (!_publishEnabled) return;
                _lastXmlSent = _xmlPublisher.Publish(doc);
                if (_lastXmlSent != null)
                    AppendLog($"[{DateTime.Now:HH:mm:ss}] Sending XML: {_lastXmlSent.Length} chars, topic=gh.event.xml\n");
            };

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
            lock (_logLock) { _debugLog += msg; }
        }

        private void OnIdleExpire(object sender, EventArgs e)
        {
            RhinoApp.Idle -= OnIdleExpire;
            ExpireSolution(true);
        }

        public string ExecuteCommand(GhCommand command) => _cmdExecutor?.Execute(OnPingDocument(), command);

        protected override void SolveInstance(IGH_DataAccess DA)
        {
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
            Cleanup();
            base.RemovedFromDocument(doc);
        }

        private void Cleanup()
        {
            _zmqService?.Dispose();
            _jobQueue?.Dispose();
            _docMonitor?.Dispose();
            RhinoZmqPlugin.Instance = null;
            _zmqService = null;
            _jobQueue = null;
            _docMonitor = null;
        }
    }
}
