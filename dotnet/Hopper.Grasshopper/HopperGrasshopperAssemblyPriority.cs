using System;
using Grasshopper.Kernel;
using Hopper.Core.Operations;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Grasshopper's assembly-load hook installs the one process-wide adapter.
    /// The adapter is detached during AppDomain teardown; the compatibility
    /// component never owns its lifetime.
    /// </summary>
    public sealed class HopperGrasshopperAssemblyPriority : GH_AssemblyPriority
    {
        private static readonly GrasshopperOperationAdapter Adapter =
            new GrasshopperOperationAdapter();
        private static bool _subscribed;

        public override GH_LoadingInstruction PriorityLoad()
        {
            if (!HostOperationRegistries.Grasshopper.TryRegister(Adapter))
                return GH_LoadingInstruction.Abort;

            Adapter.Start();

            if (!_subscribed)
            {
                AppDomain.CurrentDomain.DomainUnload += OnDomainUnload;
                AppDomain.CurrentDomain.ProcessExit += OnDomainUnload;
                _subscribed = true;
            }
            return GH_LoadingInstruction.Proceed;
        }

        private static void OnDomainUnload(object sender, EventArgs args)
        {
            HostOperationRegistries.Grasshopper.TryUnregister(Adapter);
            Adapter.Dispose();
        }
    }
}
