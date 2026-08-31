using System;
using System.IO;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.PlugIns;

namespace rhino_zmq_poc
{
    [Guid("4c3eae5e-7e91-4d5c-9bbf-d95e981c5de9")]
    public sealed class HopperRhinoPlugin : PlugIn
    {
        public HopperRhinoPlugin()
        {
            Instance = this;
            var pluginDirectory = Path.GetDirectoryName(GetType().Assembly.Location)
                ?? AppContext.BaseDirectory;
            HostManager = new HopperHostManager(pluginDirectory, new BrowserLauncher());
        }

        public static HopperRhinoPlugin Instance { get; private set; }

        internal HopperHostManager HostManager { get; }

        protected override LoadReturnCode OnLoad(ref string errorMessage)
        {
            RhinoApp.Closing += OnRhinoClosing;
            return LoadReturnCode.Success;
        }

        private void OnRhinoClosing(object sender, EventArgs e)
        {
            RhinoApp.Closing -= OnRhinoClosing;
            HostManager.Dispose();
            HopperBackendRuntime.Shared.StopBackend();
        }
    }
}
