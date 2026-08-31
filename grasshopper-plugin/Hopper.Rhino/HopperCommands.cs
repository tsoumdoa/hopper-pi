using System;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;

namespace rhino_zmq_poc
{
    [Guid("f4e34020-8f9a-4cc4-98ed-5b3596163859")]
    public sealed class HopperCommand : Command
    {
        public override string EnglishName => "Hopper";

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var plugin = HopperRhinoPlugin.Instance;
            if (plugin == null)
            {
                RhinoApp.WriteLine("Hopper plug-in is not loaded.");
                return Result.Failure;
            }

            var runtime = HopperBackendRuntime.Shared;
            if (!runtime.StartBackend())
            {
                RhinoApp.WriteLine($"Hopper backend failed: {runtime.GetStatus().LastError}");
                return Result.Failure;
            }

            var result = plugin.HostManager.StartOrOpen(runtime.GetStatus());
            RhinoApp.WriteLine(result.Message);
            return result.Accepted ? Result.Success : Result.Failure;
        }
    }

    [Guid("db50ad24-52d8-4e58-ae8a-5719994ad577")]
    public sealed class HopperStatusCommand : Command
    {
        public override string EnglishName => "HopperStatus";

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var backend = HopperBackendRuntime.Shared.GetStatus();
            var host = HopperRhinoPlugin.Instance?.HostManager.GetStatus();

            RhinoApp.WriteLine($"Hopper backend: {(backend.IsRunning ? "running" : "stopped")}");
            if (backend.IsRunning)
            {
                RhinoApp.WriteLine($"  ZMQ: {backend.PubEndpoint}, {backend.PushEndpoint}, {backend.ReqEndpoint}");
                RhinoApp.WriteLine($"  Profile: {backend.ProfilePath}");
            }
            if (!string.IsNullOrWhiteSpace(backend.LastError))
                RhinoApp.WriteLine($"  Backend error: {backend.LastError}");

            RhinoApp.WriteLine($"Hopper host: {host?.State ?? "not loaded"}");
            if (host?.ProcessId is int processId)
                RhinoApp.WriteLine($"  PID: {processId}");
            if (!string.IsNullOrWhiteSpace(host?.Origin))
                RhinoApp.WriteLine($"  Origin: {host.Origin}");
            if (!string.IsNullOrWhiteSpace(host?.LastError))
                RhinoApp.WriteLine($"  Host error: {host.LastError}");

            RhinoApp.WriteLine($"Rhino document: {doc?.Name ?? "none"}");
            RhinoApp.WriteLine($"Grasshopper document: {(string.IsNullOrWhiteSpace(backend.ActiveGrasshopperDocument) ? "none" : backend.ActiveGrasshopperDocument)}");
            return Result.Success;
        }
    }
}
