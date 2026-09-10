using System;
using System.Runtime.InteropServices;
using Hopper.Core;
using Hopper.Rhino.Host;
using Rhino;
using Rhino.Commands;

namespace rhino_zmq_poc
{
    [Guid(PublicIdentity.HopperCodeCommandId)]
    public sealed class HopperCodeCommand : Command
    {
        public override string EnglishName => PublicIdentity.HopperCodeCommandName;

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var facade = HopperRhinoPlugin.HostFacade;
            if (facade == null)
            {
                RhinoApp.WriteLine("Hopper runtime adapters are not configured.");
                return Result.Failure;
            }

            SharedNativeHost.SuppressBrowser = false;
            SharedNativeHost.MessageDocumentSerialNumber = doc?.RuntimeSerialNumber;
            SharedNativeHost.InitializeDocument(doc);
            SharedNativeHost.BootstrapTicket = null;
            RhinoCodeRunner.PreloadLanguages();
            var result = facade.RequestStart();
            RhinoApp.WriteLine(result.Message);
            return result.Accepted ? Result.Success : Result.Failure;
        }
    }

    [Guid(PublicIdentity.HopperCodeStatusCommandId)]
    public sealed class HopperCodeStatusCommand : Command
    {
        public override string EnglishName => PublicIdentity.HopperCodeStatusCommandName;

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var facade = HopperRhinoPlugin.HostFacade;
            if (facade == null)
            {
                RhinoApp.WriteLine("Hopper runtime adapters are not configured.");
                return Result.Failure;
            }

            var status = facade.GetStatus();
            foreach (var line in HopperStatusFormatter.Format(status.Runtime))
                RhinoApp.WriteLine(line);
            return Result.Success;
        }
    }

    [Guid(PublicIdentity.HopperCodeStopCommandId)]
    public sealed class HopperCodeStopCommand : Command
    {
        public override string EnglishName => PublicIdentity.HopperCodeStopCommandName;

        protected override Result RunCommand(RhinoDoc doc, RunMode mode) =>
            Run(HopperRhinoPlugin.HostFacade?.RequestStop());

        private static Result Run(HopperCommandReceipt result)
        {
            if (result == null)
            {
                RhinoApp.WriteLine("Hopper runtime adapters are not configured.");
                return Result.Failure;
            }
            RhinoApp.WriteLine(result.Message);
            return result.Accepted ? Result.Success : Result.Nothing;
        }
    }

    [Guid(PublicIdentity.HopperCodeRestartCommandId)]
    public sealed class HopperCodeRestartCommand : Command
    {
        public override string EnglishName => PublicIdentity.HopperCodeRestartCommandName;

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var facade = HopperRhinoPlugin.HostFacade;
            if (facade == null)
            {
                RhinoApp.WriteLine("Hopper runtime adapters are not configured.");
                return Result.Failure;
            }
            SharedNativeHost.MessageDocumentSerialNumber = doc?.RuntimeSerialNumber;
            SharedNativeHost.InitializeDocument(doc);
            RhinoCodeRunner.PreloadLanguages();
            var result = facade.RequestRestart();
            RhinoApp.WriteLine(result.Message);
            return result.Accepted ? Result.Success : Result.Nothing;
        }
    }
    [Guid("EA3E8228-E38E-49D3-9EA4-829C0158AB24")]
    public sealed class HopperBootstrapCommand : Command
    {
        public override string EnglishName => "HopperBootstrap";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            // Startup scripts carry only an opaque reference. Credentials remain in the private ticket.
            using var input = new Rhino.Input.Custom.GetString();
            input.SetCommandPrompt("Hopper bootstrap ticket");
            if (input.Get() != Rhino.Input.GetResult.String) return Result.Cancel;
            var ticket = input.StringResult();
            if (!System.Text.RegularExpressions.Regex.IsMatch(ticket, "^[a-f0-9]{64}$")) return Result.Failure;
            try
            {
                var record = SharedNativeHost.Read(System.IO.Path.Combine("bootstrap", ticket + ".json"));
                if (record.GetProperty("expiresAt").GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) return Result.Failure;
                var facade = HopperRhinoPlugin.HostFacade;
                if (facade is null || facade.GetStatus().Runtime.Lifecycle.State != Hopper.Core.Protocol.LifecycleState.stopped) return Result.Failure;
                SharedNativeHost.BootstrapTicket = ticket;
                SharedNativeHost.SuppressBrowser = true;
                SharedNativeHost.InitializeDocument(doc);
                return facade.RequestStart().Accepted ? Result.Success : Result.Failure;
            }
            catch { RhinoApp.WriteLine("Hopper bootstrap ticket is unavailable or invalid."); return Result.Failure; }
        }
    }

}
