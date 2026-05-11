using System;
using System.Text.Json;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public class CommandExecutor
    {
        private readonly Action<string> _log;

        public CommandExecutor(Action<string> log)
        {
            _log = log;
        }

        public string Execute(GH_Document doc, GhCommand command)
        {
            if (command == null || string.IsNullOrEmpty(command.Action))
                return "Invalid command: missing action";

            _log?.Invoke($"Executing: {command.Action}");

            string result = command.Action switch
            {
                "addComponent" => ExecuteAddComponent(doc, command.Params),
                "deleteComponent" => ExecuteDeleteComponent(doc, command.Params),
                "connectWire" => ExecuteConnectWire(doc, command.Params),
                "disconnectWire" => ExecuteDisconnectWire(doc, command.Params),
                "moveComponent" => ExecuteMoveComponent(doc, command.Params),
                "renameComponent" => ExecuteRenameComponent(doc, command.Params),
                "setComponentLocked" => ExecuteSetComponentLocked(doc, command.Params),
                "setComponentHidden" => ExecuteSetComponentHidden(doc, command.Params),
                "addGroup" => ExecuteAddGroup(doc, command.Params),
                "removeFromGroup" => ExecuteRemoveFromGroup(doc, command.Params),
                "deleteGroup" => ExecuteDeleteGroup(doc, command.Params),
                "changeGroupColor" => ExecuteChangeGroupColor(doc, command.Params),
                "renameGroup" => ExecuteRenameGroup(doc, command.Params),
                "changeGroupStyle" => ExecuteChangeGroupStyle(doc, command.Params),
                "createSlider" => ExecuteCreateSlider(doc, command.Params),
                "editSliderRange" => ExecuteEditSliderRange(doc, command.Params),
                "setSliderValue" => ExecuteSetSliderValue(doc, command.Params),
                "createPanel" => ExecuteCreatePanel(doc, command.Params),
                "setPanelParams" => ExecuteSetPanelParams(doc, command.Params),
                "setPanelText" => ExecuteSetPanelText(doc, command.Params),
                _ => $"Unknown action: {command.Action}"
            };

            _log?.Invoke($"Result: {result}");
            return result;
        }

        private string ExecuteAddComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddComponentParams>();
            if (param == null) return "addComponent: invalid params";
            return ComponentLifecycleOps.AddComponentToCanvas(doc, param);
        }

        private string ExecuteDeleteComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DeleteComponentParams>();
            if (param == null) return "deleteComponent: invalid params";
            return ComponentLifecycleOps.DeleteComponent(doc, param);
        }

        private string ExecuteMoveComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<MoveComponentParams>();
            if (param == null) return "moveComponent: invalid params";
            return ComponentLifecycleOps.MoveComponent(doc, param);
        }

        private string ExecuteRenameComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RenameComponentParams>();
            if (param == null) return "renameComponent: invalid params";
            return ComponentPropertyOps.RenameComponent(doc, param);
        }

        private string ExecuteSetComponentLocked(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetComponentLockedParams>();
            if (param == null) return "setComponentLocked: invalid params";
            return ComponentPropertyOps.SetComponentLocked(doc, param);
        }

        private string ExecuteSetComponentHidden(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetComponentHiddenParams>();
            if (param == null) return "setComponentHidden: invalid params";
            return ComponentPropertyOps.SetComponentHidden(doc, param);
        }

        private string ExecuteConnectWire(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ConnectWireParams>();
            if (param == null) return "connectWire: invalid params";
            return WireOperations.ConnectWire(doc, param);
        }

        private string ExecuteDisconnectWire(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DisconnectWireParams>();
            if (param == null) return "disconnectWire: invalid params";
            return WireOperations.DisconnectWire(doc, param);
        }

        private string ExecuteAddGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddGroupParams>();
            if (param == null) return "addGroup: invalid params";
            return GroupOperations.AddGroup(doc, param);
        }

        private string ExecuteRemoveFromGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveFromGroupParams>();
            if (param == null) return "removeFromGroup: invalid params";
            return GroupOperations.RemoveFromGroup(doc, param);
        }

        private string ExecuteDeleteGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DeleteGroupParams>();
            if (param == null) return "deleteGroup: invalid params";
            return GroupOperations.DeleteGroup(doc, param);
        }

        private string ExecuteChangeGroupColor(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ChangeGroupColorParams>();
            if (param == null) return "changeGroupColor: invalid params";
            return GroupOperations.ChangeGroupColor(doc, param);
        }

        private string ExecuteRenameGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RenameGroupParams>();
            if (param == null) return "renameGroup: invalid params";
            return GroupOperations.RenameGroup(doc, param);
        }

        private string ExecuteChangeGroupStyle(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ChangeGroupStyleParams>();
            if (param == null) return "changeGroupStyle: invalid params";
            return GroupOperations.ChangeGroupStyle(doc, param);
        }

        private string ExecuteCreateSlider(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateSliderParams>();
            if (param == null) return "createSlider: invalid params";
            return ValueOperations.CreateSlider(doc, param);
        }

        private string ExecuteEditSliderRange(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<EditSliderRangeParams>();
            if (param == null) return "editSliderRange: invalid params";
            return ValueOperations.EditSliderRange(doc, param);
        }

        private string ExecuteSetSliderValue(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetSliderValueParams>();
            if (param == null) return "setSliderValue: invalid params";
            return ValueOperations.SetSliderValue(doc, param);
        }

        private string ExecuteCreatePanel(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreatePanelParams>();
            if (param == null) return "createPanel: invalid params";
            return ValueOperations.CreatePanel(doc, param);
        }

        private string ExecuteSetPanelParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetPanelParams>();
            if (param == null) return "setPanelParams: invalid params";
            return ValueOperations.SetPanelParams(doc, param);
        }

        private string ExecuteSetPanelText(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetPanelTextParams>();
            if (param == null) return "setPanelText: invalid params";
            return ValueOperations.SetPanelText(doc, param);
        }
    }
}
