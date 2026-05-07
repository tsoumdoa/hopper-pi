using System;
using System.Linq;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class WireOperations
    {
        private static IGH_DocumentObject FindByInstanceId(GH_Document doc, string id)
        {
            if (!Guid.TryParse(id, out var guid)) return null;
            return doc.FindObject(guid, false);
        }

        private static IGH_Param FindOutputPort(IGH_DocumentObject comp, string portName)
        {
            if (comp is GH_Component ghComp)
            {
                for (int i = 0; i < ghComp.Params.Output.Count; i++)
                {
                    if (string.Equals(ghComp.Params.Output[i].Name, portName, StringComparison.OrdinalIgnoreCase))
                        return ghComp.Params.Output[i];
                }
            }
            else if (comp is IGH_Param param)
            {
                return param;
            }
            return null;
        }

        private static IGH_Param FindInputPort(IGH_DocumentObject comp, string portName)
        {
            if (comp is GH_Component ghComp)
            {
                for (int i = 0; i < ghComp.Params.Input.Count; i++)
                {
                    if (string.Equals(ghComp.Params.Input[i].Name, portName, StringComparison.OrdinalIgnoreCase))
                        return ghComp.Params.Input[i];
                }
            }
            else if (comp is IGH_Param param)
            {
                return param;
            }
            return null;
        }

        public static string ConnectWire(GH_Document doc, ConnectWireParams param)
        {
            if (doc == null)
                return "connectWire error: document is null";

            var sourceObj = FindByInstanceId(doc, param.From.ComponentId);
            if (sourceObj == null)
                return $"connectWire error: source component not found '{param.From.ComponentId}'";

            var targetObj = FindByInstanceId(doc, param.To.ComponentId);
            if (targetObj == null)
                return $"connectWire error: target component not found '{param.To.ComponentId}'";

            var sourcePort = FindOutputPort(sourceObj, param.From.Port);
            if (sourcePort == null)
                return $"connectWire error: output port '{param.From.Port}' not found on source";

            var targetPort = FindInputPort(targetObj, param.To.Port);
            if (targetPort == null)
                return $"connectWire error: input port '{param.To.Port}' not found on target";

            targetPort.AddSource(sourcePort);

            return $"connectWire: connected {param.From.ComponentId}:{param.From.Port} -> {param.To.ComponentId}:{param.To.Port}";
        }

        public static string DisconnectWire(GH_Document doc, DisconnectWireParams param)
        {
            if (doc == null)
                return "disconnectWire error: document is null";

            var sourceObj = FindByInstanceId(doc, param.From.ComponentId);
            if (sourceObj == null)
                return $"disconnectWire error: source component not found '{param.From.ComponentId}'";

            var targetObj = FindByInstanceId(doc, param.To.ComponentId);
            if (targetObj == null)
                return $"disconnectWire error: target component not found '{param.To.ComponentId}'";

            var sourcePort = FindOutputPort(sourceObj, param.From.Port);
            if (sourcePort == null)
                return $"disconnectWire error: output port '{param.From.Port}' not found on source";

            var targetPort = FindInputPort(targetObj, param.To.Port);
            if (targetPort == null)
                return $"disconnectWire error: input port '{param.To.Port}' not found on target";

            targetPort.RemoveSource(sourcePort);


            return $"disconnectWire: disconnected {param.From.ComponentId}:{param.From.Port} -> {param.To.ComponentId}:{param.To.Port}";
        }
    }
}
