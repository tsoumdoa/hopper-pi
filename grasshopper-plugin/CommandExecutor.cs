using System;
using System.Text.Json;
using Grasshopper.Kernel;
using rhino_zmq_poc.Protocol.Execution;

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
			try
			{
				return ExecuteCore(doc, command);
			}
			catch (CommandOperationException error)
			{
				return error.Message;
			}
		}

		public ActionResult ExecuteStructured(GH_Document doc, GhCommand command)
		{
			try
			{
				var message = ExecuteCore(doc, command);
				return ActionResult.Success(message, new { legacyMessage = message });
			}
			catch (CommandOperationException error)
			{
				return ActionResult.Failure(error.Code, error.Message);
			}
		}

		private string ExecuteCore(GH_Document doc, GhCommand command)
		{
			if (command == null || string.IsNullOrEmpty(command.Action))
				return CommandOperationException.Fail("Invalid command: missing action", "invalid_command");

            _log?.Invoke($"Executing: {command.Action}");

			if (!Handlers.TryGetValue(command.Action, out var handler))
				return CommandOperationException.Fail($"Unknown action: {command.Action}", "invalid_command");

            string result = handler(this, doc, command);

            _log?.Invoke($"Result: {result}");
			return result;
		}

        private string ExecuteAddComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddComponentParams>();
            if (param == null) return CommandOperationException.Fail("addComponent: invalid params", "invalid_input");
            return ComponentLifecycleOps.AddComponentToCanvas(doc, param);
        }

        private string ExecuteDeleteComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DeleteComponentParams>();
            if (param == null) return CommandOperationException.Fail("deleteComponent: invalid params", "invalid_input");
            return ComponentLifecycleOps.DeleteComponent(doc, param);
        }

        private string ExecuteMoveComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<MoveComponentParams>();
            if (param == null) return CommandOperationException.Fail("moveComponent: invalid params", "invalid_input");
            return ComponentLifecycleOps.MoveComponent(doc, param);
        }

        private string ExecuteRenameComponent(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RenameComponentParams>();
            if (param == null) return CommandOperationException.Fail("renameComponent: invalid params", "invalid_input");
            return ComponentPropertyOps.RenameComponent(doc, param);
        }

        private string ExecuteSetComponentLocked(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetComponentLockedParams>();
            if (param == null) return CommandOperationException.Fail("setComponentLocked: invalid params", "invalid_input");
            return ComponentPropertyOps.SetComponentLocked(doc, param);
        }

        private string ExecuteSetComponentHidden(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetComponentHiddenParams>();
            if (param == null) return CommandOperationException.Fail("setComponentHidden: invalid params", "invalid_input");
            return ComponentPropertyOps.SetComponentHidden(doc, param);
        }

        private string ExecuteConnectWire(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ConnectWireParams>();
            if (param == null) return CommandOperationException.Fail("connectWire: invalid params", "invalid_input");
            return WireOperations.ConnectWire(doc, param);
        }

        private string ExecuteDisconnectWire(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DisconnectWireParams>();
            if (param == null) return CommandOperationException.Fail("disconnectWire: invalid params", "invalid_input");
            return WireOperations.DisconnectWire(doc, param);
        }

        private string ExecuteAddGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddGroupParams>();
            if (param == null) return CommandOperationException.Fail("addGroup: invalid params", "invalid_input");
            return GroupOperations.AddGroup(doc, param);
        }

        private string ExecuteRemoveFromGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveFromGroupParams>();
            if (param == null) return CommandOperationException.Fail("removeFromGroup: invalid params", "invalid_input");
            return GroupOperations.RemoveFromGroup(doc, param);
        }

        private string ExecuteDeleteGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<DeleteGroupParams>();
            if (param == null) return CommandOperationException.Fail("deleteGroup: invalid params", "invalid_input");
            return GroupOperations.DeleteGroup(doc, param);
        }

        private string ExecuteChangeGroupColor(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ChangeGroupColorParams>();
            if (param == null) return CommandOperationException.Fail("changeGroupColor: invalid params", "invalid_input");
            return GroupOperations.ChangeGroupColor(doc, param);
        }

        private string ExecuteRenameGroup(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RenameGroupParams>();
            if (param == null) return CommandOperationException.Fail("renameGroup: invalid params", "invalid_input");
            return GroupOperations.RenameGroup(doc, param);
        }

        private string ExecuteChangeGroupStyle(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ChangeGroupStyleParams>();
            if (param == null) return CommandOperationException.Fail("changeGroupStyle: invalid params", "invalid_input");
            return GroupOperations.ChangeGroupStyle(doc, param);
        }

        private string ExecuteCreateSlider(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateSliderParams>();
            if (param == null) return CommandOperationException.Fail("createSlider: invalid params", "invalid_input");
            return ValueOperations.CreateSlider(doc, param);
        }

        private string ExecuteEditSliderRange(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<EditSliderRangeParams>();
            if (param == null) return CommandOperationException.Fail("editSliderRange: invalid params", "invalid_input");
            return ValueOperations.EditSliderRange(doc, param);
        }

        private string ExecuteSetSliderValue(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetSliderValueParams>();
            if (param == null) return CommandOperationException.Fail("setSliderValue: invalid params", "invalid_input");
            return ValueOperations.SetSliderValue(doc, param);
        }

        private string ExecuteCreatePanel(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreatePanelParams>();
            if (param == null) return CommandOperationException.Fail("createPanel: invalid params", "invalid_input");
            return ValueOperations.CreatePanel(doc, param);
        }

        private string ExecuteSetPanelParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetPanelParams>();
            if (param == null) return CommandOperationException.Fail("setPanelParams: invalid params", "invalid_input");
            return ValueOperations.SetPanelParams(doc, param);
        }

        private string ExecuteSetPanelText(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetPanelTextParams>();
            if (param == null) return CommandOperationException.Fail("setPanelText: invalid params", "invalid_input");
            return ValueOperations.SetPanelText(doc, param);
        }

        private string ExecuteCreateToggle(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateToggleParams>();
            if (param == null) return CommandOperationException.Fail("createToggle: invalid params", "invalid_input");
            return SpecialOperations.CreateToggle(doc, param);
        }

        private string ExecuteSetToggleValue(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetToggleValueParams>();
            if (param == null) return CommandOperationException.Fail("setToggleValue: invalid params", "invalid_input");
            return SpecialOperations.SetToggleValue(doc, param);
        }

        private string ExecuteCreateSwatch(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateSwatchParams>();
            if (param == null) return CommandOperationException.Fail("createSwatch: invalid params", "invalid_input");
            return SpecialOperations.CreateSwatch(doc, param);
        }

        private string ExecuteSetSwatchColor(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetSwatchColorParams>();
            if (param == null) return CommandOperationException.Fail("setSwatchColor: invalid params", "invalid_input");
            return SpecialOperations.SetSwatchColor(doc, param);
        }

        private string ExecuteCreateScribble(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateScribbleParams>();
            if (param == null) return CommandOperationException.Fail("createScribble: invalid params", "invalid_input");
            return SpecialOperations.CreateScribble(doc, param);
        }

        private string ExecuteSetScribbleText(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetScribbleTextParams>();
            if (param == null) return CommandOperationException.Fail("setScribbleText: invalid params", "invalid_input");
            return SpecialOperations.SetScribbleText(doc, param);
        }

        private string ExecuteCreateValueList(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateValueListParams>();
            if (param == null) return CommandOperationException.Fail("createValueList: invalid params", "invalid_input");
            return SpecialOperations.CreateValueList(doc, param);
        }

        private string ExecuteSetValueListSelected(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetValueListSelectedParams>();
            if (param == null) return CommandOperationException.Fail("setValueListSelected: invalid params", "invalid_input");
            return SpecialOperations.SetValueListSelected(doc, param);
        }

        private string ExecuteCreateScriptNode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<CreateScriptNodeParams>();
            if (param == null) return CommandOperationException.Fail("createScriptNode: invalid params", "invalid_input");
            return ScriptOperations.CreateScriptNode(doc, param);
        }

        private string ExecuteSetScriptCode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SetScriptCodeParams>();
            if (param == null) return CommandOperationException.Fail("setScriptCode: invalid params", "invalid_input");
            return ScriptOperations.SetScriptCode(doc, param);
        }

        private string ExecuteSyncScriptParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<SyncScriptParamsParams>();
            if (param == null) return CommandOperationException.Fail("syncScriptParams: invalid params", "invalid_input");
            return ScriptOperations.SyncParams(doc, param);
        }

        private string ExecuteGetScriptCode(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<GetScriptCodeParams>();
            if (param == null) return CommandOperationException.Fail("getScriptCode: invalid params", "invalid_input");
            return ScriptOperations.GetScriptCode(doc, param);
        }

        private string ExecuteAddScriptInput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddScriptInputParams>();
            if (param == null) return CommandOperationException.Fail("addScriptInput: invalid params", "invalid_input");
            return ScriptOperations.AddInputParam(doc, param);
        }

        private string ExecuteRemoveScriptInput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveScriptInputParams>();
            if (param == null) return CommandOperationException.Fail("removeScriptInput: invalid params", "invalid_input");
            return ScriptOperations.RemoveInputParam(doc, param);
        }

        private string ExecuteAddScriptOutput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<AddScriptOutputParams>();
            if (param == null) return CommandOperationException.Fail("addScriptOutput: invalid params", "invalid_input");
            return ScriptOperations.AddOutputParam(doc, param);
        }

        private string ExecuteRemoveScriptOutput(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<RemoveScriptOutputParams>();
            if (param == null) return CommandOperationException.Fail("removeScriptOutput: invalid params", "invalid_input");
            return ScriptOperations.RemoveOutputParam(doc, param);
        }

        private string ExecuteListScriptParams(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<ListScriptParamsParams>();
            if (param == null) return CommandOperationException.Fail("listScriptParams: invalid params", "invalid_input");
            return ComponentLifecycleOps.ListScriptParams(doc, param);
        }

        private string ExecuteEditParamProps(GH_Document doc, JsonElement p)
        {
            var param = p.Deserialize<EditParamPropsParams>();
            if (param == null) return CommandOperationException.Fail("editParamProps: invalid params", "invalid_input");
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
                return CommandOperationException.Fail("setParamRhinoGeometry error: invalid params");
            if (string.IsNullOrWhiteSpace(param.TargetId))
                return CommandOperationException.Fail("setParamRhinoGeometry error: missing targetId");
            var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
            return RhinoParamGeometryOps.SetParamRhinoGeometry(doc, rhinoDoc, param);
        }
    }
}
