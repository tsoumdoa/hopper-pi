using System;
using System.Runtime.InteropServices;
using System.Threading;
using Hopper.Core;
using Hopper.Rhino.Host;
using Rhino;
using Rhino.PlugIns;

namespace rhino_zmq_poc
{
    [Guid(PublicIdentity.RhinoPluginId)]
    public sealed class HopperRhinoPlugin : PlugIn
    {
        private static IHopperHostFacade _hostFacade;

        public HopperRhinoPlugin()
        {
            Instance = this;
        }

        public static HopperRhinoPlugin Instance { get; private set; }

        internal static IHopperHostFacade HostFacade => Volatile.Read(ref _hostFacade);

        internal static bool TryConfigureHostFacade(IHopperHostFacade facade)
        {
            if (facade == null)
                throw new ArgumentNullException(nameof(facade));
            return ReferenceEquals(
                Interlocked.CompareExchange(ref _hostFacade, facade, null),
                null);
        }

        protected override LoadReturnCode OnLoad(ref string errorMessage)
        {
            RhinoApp.Closing += OnRhinoClosing;
            return LoadReturnCode.Success;
        }

        private void OnRhinoClosing(object sender, EventArgs e)
        {
            RhinoApp.Closing -= OnRhinoClosing;
            HostFacade?.CloseForRhinoExit();
        }
    }
}
