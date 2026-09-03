using System;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Hopper.Core;
using Rhino;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Compatibility component for existing definitions. The process-wide backend
    /// is owned by HopperBackendRuntime and remains alive when this component leaves
    /// a canvas.
    /// </summary>
    public class rhino_zmq_pocComponent : GH_Component
    {
        private readonly HopperBackendRuntime _runtime = HopperBackendRuntime.Shared;
        private bool _publishEnabled = true;
        private bool _subscribed;

        public rhino_zmq_pocComponent()
            : base("Hopper Code Backend", "GHZMQ",
                "CLI-GH Connector: ZMQ pub/sub and command execution",
                "Params", "Util")
        {
        }

        public override void AddedToDocument(GH_Document doc)
        {
            base.AddedToDocument(doc);
            Subscribe();
            ExpireSolution(true);
        }

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddBooleanParameter(
                "Enable Pub",
                "PUB",
                "Enable/disable XML publishing on solution end",
                GH_ParamAccess.item,
                true);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Debug Log", "LOG", "ZMQ debug output", GH_ParamAccess.list);
            pManager.AddTextParameter("Job Received", "JOB", "Last received job (jobId|commandId|action)", GH_ParamAccess.item);
            pManager.AddTextParameter("Last XML", "XML", "Last published XML snapshot", GH_ParamAccess.item);
        }

        protected override void BeforeSolveInstance()
        {
            Subscribe();
            if (!_runtime.StartBackend())
            {
                var error = _runtime.GetStatus().LastError;
                AddRuntimeMessage(
                    GH_RuntimeMessageLevel.Error,
                    string.IsNullOrWhiteSpace(error) ? "Hopper backend failed to start" : error);
            }
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            DA.GetData(0, ref _publishEnabled);
            _runtime.SetLegacyPublishPreference(InstanceGuid, _publishEnabled);

            var status = _runtime.GetStatus();
            var logLines = (status.DebugLog ?? "")
                .Split('\n')
                .Where(line => !string.IsNullOrEmpty(line))
                .ToArray();
            DA.SetDataList(0, logLines);
            DA.SetData(1, status.LastJobReceived ?? "");
            DA.SetData(2, status.LastXmlSent ?? "");
        }

        private void Subscribe()
        {
            if (_subscribed)
                return;
            _runtime.Changed += OnRuntimeChanged;
            _subscribed = true;
        }

        private void OnRuntimeChanged()
        {
            try
            {
                RhinoApp.InvokeOnUiThread((Action)(() =>
                {
                    if (OnPingDocument() != null)
                        ExpireSolution(false);
                }));
            }
            catch
            {
                // Rhino may be closing or this object may already be detached.
            }
        }

        public override GH_Exposure Exposure => GH_Exposure.primary;

        protected override Bitmap Icon => PluginIcon.Bitmap;

        public override Guid ComponentGuid => new Guid(PublicIdentity.LegacyGrasshopperComponentId);

        public override void RemovedFromDocument(GH_Document doc)
        {
            _runtime.RemoveLegacyPublishPreference(InstanceGuid);
            if (_subscribed)
            {
                _runtime.Changed -= OnRuntimeChanged;
                _subscribed = false;
            }
            base.RemovedFromDocument(doc);
        }
    }
}
