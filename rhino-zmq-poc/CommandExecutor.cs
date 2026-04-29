using System;
using System.Text.Json;

namespace rhino_zmq_poc
{
    public class CommandExecutor
    {
        private readonly Action<string> _log;

        public CommandExecutor(Action<string> log)
        {
            _log = log;
        }

        public string Execute(GhCommand command)
        {
            if (command == null || string.IsNullOrEmpty(command.Action))
                return "Invalid command: missing action";

            _log?.Invoke($"Executing: {command.Action}");

            string result = command.Action switch
            {
                "addComponent" => MockAddComponent(command.Params),
                "deleteComponent" => MockDeleteComponent(command.Params),
                "connectWire" => MockConnectWire(command.Params),
                "disconnectWire" => MockDisconnectWire(command.Params),
                "moveComponent" => MockMoveComponent(command.Params),
                "renameComponent" => MockRenameComponent(command.Params),
                "setComponentLocked" => MockSetComponentLocked(command.Params),
                "setComponentHidden" => MockSetComponentHidden(command.Params),
                "addGroup" => MockAddGroup(command.Params),
                "removeFromGroup" => MockRemoveFromGroup(command.Params),
                "setSliderValue" => MockSetSliderValue(command.Params),
                "setPanelText" => MockSetPanelText(command.Params),
                _ => $"Unknown action: {command.Action}"
            };

            _log?.Invoke($"Result: {result}");
            return result;
        }

        private string MockAddComponent(JsonElement p) =>
            $"MOCK: addComponent - would add {p.GetProperty("componentType").GetString()}";

        private string MockDeleteComponent(JsonElement p) =>
            $"MOCK: deleteComponent - would delete {p.GetProperty("targetId").GetString()}";

        private string MockConnectWire(JsonElement p) =>
            $"MOCK: connectWire - would connect {p.GetProperty("from").GetProperty("componentId")} -> {p.GetProperty("to").GetProperty("componentId")}";

        private string MockDisconnectWire(JsonElement p) =>
            $"MOCK: disconnectWire - would disconnect";

        private string MockMoveComponent(JsonElement p) =>
            $"MOCK: moveComponent - would move {p.GetProperty("targetId").GetString()}";

        private string MockRenameComponent(JsonElement p) =>
            $"MOCK: renameComponent - would rename {p.GetProperty("targetId").GetString()} to {p.GetProperty("nickName").GetString()}";

        private string MockSetComponentLocked(JsonElement p) =>
            $"MOCK: setComponentLocked - would set locked={p.GetProperty("locked").GetBoolean()}";

        private string MockSetComponentHidden(JsonElement p) =>
            $"MOCK: setComponentHidden - would set hidden={p.GetProperty("hidden").GetBoolean()}";

        private string MockAddGroup(JsonElement p) =>
            $"MOCK: addGroup - would add group {p.GetProperty("groupName").GetString()}";

        private string MockRemoveFromGroup(JsonElement p) =>
            $"MOCK: removeFromGroup - would remove from group";

        private string MockSetSliderValue(JsonElement p) =>
            $"MOCK: setSliderValue - would set {p.GetProperty("targetId").GetString()} = {p.GetProperty("value").GetDouble()}";

        private string MockSetPanelText(JsonElement p) =>
            $"MOCK: setPanelText - would set {p.GetProperty("targetId").GetString()} = \"{p.GetProperty("text").GetString()}\"";
    }
}