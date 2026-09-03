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
            var result = facade.RequestRestart();
            RhinoApp.WriteLine(result.Message);
            return result.Accepted ? Result.Success : Result.Nothing;
        }
    }
}
