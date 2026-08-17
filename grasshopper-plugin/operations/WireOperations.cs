using System;
using System.Linq;
using System.Text.Json;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class WireOperations
    {
        private static bool PortNameMatches(IGH_Param param, string name) =>
            string.Equals(param.Name, name, StringComparison.Ordinal) ||
            string.Equals(param.NickName, name, StringComparison.Ordinal);

        private static bool TrySelectPort(
            IGH_DocumentObject obj,
            JsonElement selector,
            bool output,
            out IGH_Param port,
            out string error)
        {
            port = null;
            error = null;
            var ports = obj is GH_Component component
                ? (output ? component.Params.Output : component.Params.Input).ToList()
                : obj is IGH_Param parameter
                    ? new[] { parameter }.ToList()
                    : new System.Collections.Generic.List<IGH_Param>();

            if (selector.ValueKind == JsonValueKind.Number && selector.TryGetInt32(out var index))
            {
                if (index >= 0 && index < ports.Count)
                {
                    port = ports[index];
                    return true;
                }
                error = $"{(output ? "output" : "input")} index {index} is out of range (count={ports.Count})";
                return false;
            }

            if (selector.ValueKind == JsonValueKind.String)
            {
                var name = selector.GetString();
                var matches = ports.Where(candidate => PortNameMatches(candidate, name)).ToList();
                if (matches.Count == 1)
                {
                    port = matches[0];
                    return true;
                }
                error = matches.Count == 0
                    ? $"{(output ? "output" : "input")} port '{name}' was not found"
                    : $"{(output ? "output" : "input")} port '{name}' is ambiguous";
                return false;
            }

            error = "port selector must be a name or zero-based index";
            return false;
        }

        public static bool TryConnectBySelector(
            IGH_DocumentObject source,
            JsonElement sourceSelector,
            IGH_DocumentObject target,
            JsonElement targetSelector,
            out string error)
        {
            error = null;
            if (!TrySelectPort(source, sourceSelector, true, out var sourcePort, out error))
                return false;
            if (!TrySelectPort(target, targetSelector, false, out var targetPort, out error))
                return false;
            targetPort.AddSource(sourcePort);
            target.ExpireSolution(false);
            return true;
        }

        private static IGH_DocumentObject FindByInstanceId(GH_Document doc, string id)
        {
            if (!Guid.TryParse(id, out var guid)) return null;
            return doc.FindObject(guid, false);
        }

        private static IGH_Param FindPort(IGH_DocumentObject comp, string portId, bool isOutput)
        {
            if (!Guid.TryParse(portId, out var portGuid)) return null;

            if (comp is GH_Component ghComp)
            {
                var ports = isOutput ? ghComp.Params.Output : ghComp.Params.Input;
                for (int i = 0; i < ports.Count; i++)
                {
                    if (ports[i].InstanceGuid == portGuid)
                        return ports[i];
                }
            }
            else if (comp is IGH_Param param && param.InstanceGuid == portGuid)
            {
                return param;
            }
            return null;
        }

        private static IGH_Param FindOutputPort(IGH_DocumentObject comp, string portId)
            => FindPort(comp, portId, isOutput: true);

        private static IGH_Param FindInputPort(IGH_DocumentObject comp, string portId)
            => FindPort(comp, portId, isOutput: false);

        public static string ConnectWire(GH_Document doc, ConnectWireParams param)
        {
            if (doc == null)
                return CommandOperationException.Fail("connectWire error: document is null");

            var sourceObj = FindByInstanceId(doc, param.From.ComponentId);
            if (sourceObj == null)
                return CommandOperationException.Fail($"connectWire error: source component not found '{param.From.ComponentId}'");

            var targetObj = FindByInstanceId(doc, param.To.ComponentId);
            if (targetObj == null)
                return CommandOperationException.Fail($"connectWire error: target component not found '{param.To.ComponentId}'");

            var sourcePort = FindOutputPort(sourceObj, param.From.Port);
            if (sourcePort == null)
                return CommandOperationException.Fail($"connectWire error: output port '{param.From.Port}' not found on source");

            var targetPort = FindInputPort(targetObj, param.To.Port);
            if (targetPort == null)
                return CommandOperationException.Fail($"connectWire error: input port '{param.To.Port}' not found on target");

            targetPort.AddSource(sourcePort);
						targetObj.ExpireSolution(true);
            doc.NewSolution(false);


            return $"connectWire: connected {param.From.ComponentId}:{param.From.Port} -> {param.To.ComponentId}:{param.To.Port}";
        }

        public static string DisconnectWire(GH_Document doc, DisconnectWireParams param)
        {
            if (doc == null)
                return CommandOperationException.Fail("disconnectWire error: document is null");

            var sourceObj = FindByInstanceId(doc, param.From.ComponentId);
            if (sourceObj == null)
                return CommandOperationException.Fail($"disconnectWire error: source component not found '{param.From.ComponentId}'");

            var targetObj = FindByInstanceId(doc, param.To.ComponentId);
            if (targetObj == null)
                return CommandOperationException.Fail($"disconnectWire error: target component not found '{param.To.ComponentId}'");

            var sourcePort = FindOutputPort(sourceObj, param.From.Port);
            if (sourcePort == null)
                return CommandOperationException.Fail($"disconnectWire error: output port '{param.From.Port}' not found on source");

            var targetPort = FindInputPort(targetObj, param.To.Port);
            if (targetPort == null)
                return CommandOperationException.Fail($"disconnectWire error: input port '{param.To.Port}' not found on target");

            targetPort.RemoveSource(sourcePort);
						targetObj.ExpireSolution(true);
            doc.NewSolution(false);


            return $"disconnectWire: disconnected {param.From.ComponentId}:{param.From.Port} -> {param.To.ComponentId}:{param.To.Port}";
        }
    }
}
