using System;
using Grasshopper;
using Grasshopper.Kernel;
using Hopper.Core.Grasshopper;
using Hopper.Core.Operations;
using Hopper.Core.Runtime;
using Rhino;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Grasshopper's assembly-load hook marks the capability as loading. Adapter
    /// registration waits for the first Rhino idle callback after ComponentServer
    /// exists, which keeps PriorityLoad clear of partially initialized GH services.
    /// </summary>
    public sealed class HopperGrasshopperAssemblyPriority : GH_AssemblyPriority
    {
        private const string InitializationFailureCode =
            "GRASSHOPPER_ADAPTER_INITIALIZATION_FAILED";
        private static readonly GrasshopperOperationAdapter Adapter =
            new GrasshopperOperationAdapter();
        private static bool _lifetimeSubscribed;
        private static bool _idleSubscribed;

        public override GH_LoadingInstruction PriorityLoad()
        {
            var registry = HostOperationRegistries.Grasshopper;
            if (registry.Status.State == GrasshopperCapabilityState.Ready)
                return GH_LoadingInstruction.Proceed;

            registry.SetInstalled(true);
            registry.MarkLoading();
            if (!_lifetimeSubscribed)
            {
                AppDomain.CurrentDomain.DomainUnload += OnDomainUnload;
                AppDomain.CurrentDomain.ProcessExit += OnDomainUnload;
                _lifetimeSubscribed = true;
            }
            if (!_idleSubscribed)
            {
                RhinoApp.Idle += OnRhinoIdle;
                _idleSubscribed = true;
            }

            return GH_LoadingInstruction.Proceed;
        }

        private static void OnRhinoIdle(object sender, EventArgs args)
        {
            if (!Instances.IsComponentServer)
                return;

            RemoveIdleHook();
            var registry = HostOperationRegistries.Grasshopper;
            try
            {
                if (!registry.TryRegister(Adapter))
                    throw new InvalidOperationException("A different Grasshopper adapter is already registered.");
                Adapter.Start();
            }
            catch (Exception exception)
            {
                registry.TryUnregister(Adapter);
                Adapter.Dispose();
                registry.MarkFailed(InitializationFailureCode, exception.Message);
                HostOperationRegistries.DocumentStatus.Report(
                    new HostDocumentStatusChange(
                        HostDocumentKind.Grasshopper,
                        false,
                        null));
            }
        }

        private static void OnDomainUnload(object sender, EventArgs args)
        {
            RemoveIdleHook();
            HostOperationRegistries.Grasshopper.TryUnregister(Adapter);
            Adapter.Dispose();
        }

        private static void RemoveIdleHook()
        {
            if (!_idleSubscribed)
                return;
            RhinoApp.Idle -= OnRhinoIdle;
            _idleSubscribed = false;
        }
    }
}
