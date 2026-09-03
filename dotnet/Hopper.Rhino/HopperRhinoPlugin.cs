using System;
using System.IO;
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
        private RhinoHostComposition _composition;

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

        internal static bool TryClearHostFacade(IHopperHostFacade facade) =>
            ReferenceEquals(
                Interlocked.CompareExchange(ref _hostFacade, null, facade),
                facade);

        protected override LoadReturnCode OnLoad(ref string errorMessage)
        {
            try
            {
                var pluginDirectory = Path.GetDirectoryName(GetType().Assembly.Location)
                    ?? AppContext.BaseDirectory;
                _composition = RhinoHostComposition.Create(pluginDirectory);
                if (!TryConfigureHostFacade(_composition.Facade))
                    throw new InvalidOperationException("A different Hopper host facade is already configured.");
                RhinoApp.Closing += OnRhinoClosing;
                return LoadReturnCode.Success;
            }
            catch (Exception exception)
            {
                _composition?.Dispose();
                _composition = null;
                errorMessage = $"Could not compose HopperCode: {exception.Message}";
                return LoadReturnCode.ErrorShowDialog;
            }
        }

        protected override void OnShutdown()
        {
            RhinoApp.Closing -= OnRhinoClosing;
            var composition = _composition;
            _composition = null;
            if (composition == null)
                return;
            TryClearHostFacade(composition.Facade);
            composition.CloseForRhinoExit();
        }

        private void OnRhinoClosing(object sender, EventArgs e)
        {
            RhinoApp.Closing -= OnRhinoClosing;
            var composition = _composition;
            _composition = null;
            if (composition == null)
                return;
            TryClearHostFacade(composition.Facade);
            composition.CloseForRhinoExit();
        }
    }
}
