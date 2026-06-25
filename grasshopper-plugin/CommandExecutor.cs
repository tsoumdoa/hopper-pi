using System;
using System.Text.Json;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal partial class CommandExecutor
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

            if (!Handlers.TryGetValue(command.Action, out var handler))
                return $"Unknown action: {command.Action}";

            string result = handler(this, doc, command);

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

        private string ExecuteCreateToggle(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateToggleParams>();
            if (param == null) return "createToggle: invalid params";
            return SpecialOperations.CreateToggle(doc, param);
        }

        private string ExecuteSetToggleValue(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetToggleValueParams>();
            if (param == null) return "setToggleValue: invalid params";
            return SpecialOperations.SetToggleValue(doc, param);
        }

        private string ExecuteCreateSwatch(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateSwatchParams>();
            if (param == null) return "createSwatch: invalid params";
            return SpecialOperations.CreateSwatch(doc, param);
        }

        private string ExecuteSetSwatchColor(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetSwatchColorParams>();
            if (param == null) return "setSwatchColor: invalid params";
            return SpecialOperations.SetSwatchColor(doc, param);
        }

        private string ExecuteCreateScribble(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateScribbleParams>();
            if (param == null) return "createScribble: invalid params";
            return SpecialOperations.CreateScribble(doc, param);
        }

        private string ExecuteSetScribbleText(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetScribbleTextParams>();
            if (param == null) return "setScribbleText: invalid params";
            return SpecialOperations.SetScribbleText(doc, param);
        }

        private string ExecuteCreateValueList(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateValueListParams>();
            if (param == null) return "createValueList: invalid params";
            return SpecialOperations.CreateValueList(doc, param);
        }

        private string ExecuteSetValueListSelected(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetValueListSelectedParams>();
            if (param == null) return "setValueListSelected: invalid params";
            return SpecialOperations.SetValueListSelected(doc, param);
        }

        private string ExecuteCreateScriptNode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateScriptNodeParams>();
            if (param == null) return "createScriptNode: invalid params";
            return ScriptOperations.CreateScriptNode(doc, param);
        }

        private string ExecuteSetScriptCode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetScriptCodeParams>();
            if (param == null) return "setScriptCode: invalid params";
            return ScriptOperations.SetScriptCode(doc, param);
        }

        private string ExecuteSyncScriptParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SyncScriptParamsParams>();
            if (param == null) return "syncScriptParams: invalid params";
            return ScriptOperations.SyncParams(doc, param);
        }

        private string ExecuteGetScriptCode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<GetScriptCodeParams>();
            if (param == null) return "getScriptCode: invalid params";
            return ScriptOperations.GetScriptCode(doc, param);
        }

        private string ExecuteAddScriptInput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddScriptInputParams>();
            if (param == null) return "addScriptInput: invalid params";
            return ScriptOperations.AddInputParam(doc, param);
        }

        private string ExecuteRemoveScriptInput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveScriptInputParams>();
            if (param == null) return "removeScriptInput: invalid params";
            return ScriptOperations.RemoveInputParam(doc, param);
        }

        private string ExecuteAddScriptOutput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddScriptOutputParams>();
            if (param == null) return "addScriptOutput: invalid params";
            return ScriptOperations.AddOutputParam(doc, param);
        }

        private string ExecuteRemoveScriptOutput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveScriptOutputParams>();
            if (param == null) return "removeScriptOutput: invalid params";
            return ScriptOperations.RemoveOutputParam(doc, param);
        }

        private string ExecuteListScriptParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ListScriptParamsParams>();
            if (param == null) return "listScriptParams: invalid params";
            return ComponentLifecycleOps.ListScriptParams(doc, param);
        }

        private string ExecuteEditParamProps(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<EditParamPropsParams>();
            if (param == null) return "editParamProps: invalid params";
            return ComponentLifecycleOps.EditParamProps(doc, param);
        }

        private string ExecuteBeginAgentTransaction(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<BeginAgentTransactionParams>();
            return AgentTransaction.Begin(doc, param?.Name);
        }

        private string ExecuteCommitAgentTransaction(GH_Document doc, JsonElement _)
            => AgentTransaction.Commit(doc);

        private string ExecuteCancelAgentTransaction(GH_Document doc, JsonElement _)
            => AgentTransaction.Cancel(doc);

        private string ExecuteBeginRhinoAgentTransaction(JsonElement p)
        {
            var param = p.Deserialize<BeginAgentTransactionParams>();
            var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
            return RhinoAgentTransaction.Begin(rhinoDoc, param?.Name);
        }

        private string ExecuteCommitRhinoAgentTransaction()
        {
            var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
            return RhinoAgentTransaction.Commit(rhinoDoc);
        }

        private string ExecuteCancelRhinoAgentTransaction()
        {
            var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
            return RhinoAgentTransaction.Cancel(rhinoDoc);
        }

        private string ExecuteSetParamRhinoGeometry(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetParamRhinoGeometryParams>();
            if (param == null)
                return "setParamRhinoGeometry error: invalid params";
            if (string.IsNullOrWhiteSpace(param.TargetId))
                return "setParamRhinoGeometry error: missing targetId";
            var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
            return RhinoParamGeometryOps.SetParamRhinoGeometry(doc, rhinoDoc, param);
        }
    }
}

