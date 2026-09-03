using System;
using System.Drawing;
using Grasshopper.Kernel;
using Hopper.Core;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Compatibility component for existing definitions. Runtime ownership belongs
    /// to the Rhino plug-in; this component never starts transport or Node.
    /// </summary>
    public class rhino_zmq_pocComponent : GH_Component
    {
        public rhino_zmq_pocComponent()
            : base("Hopper Code Backend", "GHZMQ",
                "CLI-GH Connector: ZMQ pub/sub and command execution",
                "Params", "Util")
        {
        }

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddBooleanParameter(
                "Enable Pub",
                "PUB",
                "Legacy compatibility input; publishing is owned by HopperCode",
                GH_ParamAccess.item,
                true);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Debug Log", "LOG", "ZMQ debug output", GH_ParamAccess.list);
            pManager.AddTextParameter("Job Received", "JOB", "Last received job (jobId|commandId|action)", GH_ParamAccess.item);
            pManager.AddTextParameter("Last XML", "XML", "Last published XML snapshot", GH_ParamAccess.item);
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            var enabled = true;
            DA.GetData(0, ref enabled);
            DA.SetDataList(0, new[]
            {
                "Compatibility component only. Use HopperCode to manage the host."
            });
            DA.SetData(1, "");
            DA.SetData(2, "");
        }

        public override GH_Exposure Exposure => GH_Exposure.primary;

        protected override Bitmap Icon => PluginIcon.Bitmap;

        public override Guid ComponentGuid => new Guid(PublicIdentity.LegacyGrasshopperComponentId);

    }
}
