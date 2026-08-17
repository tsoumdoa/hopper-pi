using System;
using System.Collections.Generic;
using System.Text.Json;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    internal partial class CommandExecutor
    {
        private delegate string CommandHandler(CommandExecutor executor, GH_Document doc, RhinoDoc rhinoDoc, GhCommand command);

        private static readonly IReadOnlyDictionary<string, CommandHandler> Handlers =
            new Dictionary<string, CommandHandler>(StringComparer.Ordinal)
            {
                ["addComponent"] = (ex, doc, _, cmd) => ex.ExecuteAddComponent(doc, cmd.Params),
                ["deleteComponent"] = (ex, doc, _, cmd) => ex.ExecuteDeleteComponent(doc, cmd.Params),
                ["connectWire"] = (ex, doc, _, cmd) => ex.ExecuteConnectWire(doc, cmd.Params),
                ["disconnectWire"] = (ex, doc, _, cmd) => ex.ExecuteDisconnectWire(doc, cmd.Params),
                ["moveComponent"] = (ex, doc, _, cmd) => ex.ExecuteMoveComponent(doc, cmd.Params),
                ["renameComponent"] = (ex, doc, _, cmd) => ex.ExecuteRenameComponent(doc, cmd.Params),
                ["setComponentLocked"] = (ex, doc, _, cmd) => ex.ExecuteSetComponentLocked(doc, cmd.Params),
                ["setComponentHidden"] = (ex, doc, _, cmd) => ex.ExecuteSetComponentHidden(doc, cmd.Params),
                ["addGroup"] = (ex, doc, _, cmd) => ex.ExecuteAddGroup(doc, cmd.Params),
                ["removeFromGroup"] = (ex, doc, _, cmd) => ex.ExecuteRemoveFromGroup(doc, cmd.Params),
                ["deleteGroup"] = (ex, doc, _, cmd) => ex.ExecuteDeleteGroup(doc, cmd.Params),
                ["changeGroupColor"] = (ex, doc, _, cmd) => ex.ExecuteChangeGroupColor(doc, cmd.Params),
                ["renameGroup"] = (ex, doc, _, cmd) => ex.ExecuteRenameGroup(doc, cmd.Params),
                ["changeGroupStyle"] = (ex, doc, _, cmd) => ex.ExecuteChangeGroupStyle(doc, cmd.Params),
                ["createSlider"] = (ex, doc, _, cmd) => ex.ExecuteCreateSlider(doc, cmd.Params),
                ["editSliderRange"] = (ex, doc, _, cmd) => ex.ExecuteEditSliderRange(doc, cmd.Params),
                ["setSliderValue"] = (ex, doc, _, cmd) => ex.ExecuteSetSliderValue(doc, cmd.Params),
                ["createPanel"] = (ex, doc, _, cmd) => ex.ExecuteCreatePanel(doc, cmd.Params),
                ["setPanelParams"] = (ex, doc, _, cmd) => ex.ExecuteSetPanelParams(doc, cmd.Params),
                ["setPanelText"] = (ex, doc, _, cmd) => ex.ExecuteSetPanelText(doc, cmd.Params),
                ["createToggle"] = (ex, doc, _, cmd) => ex.ExecuteCreateToggle(doc, cmd.Params),
                ["setToggleValue"] = (ex, doc, _, cmd) => ex.ExecuteSetToggleValue(doc, cmd.Params),
                ["createSwatch"] = (ex, doc, _, cmd) => ex.ExecuteCreateSwatch(doc, cmd.Params),
                ["setSwatchColor"] = (ex, doc, _, cmd) => ex.ExecuteSetSwatchColor(doc, cmd.Params),
                ["createScribble"] = (ex, doc, _, cmd) => ex.ExecuteCreateScribble(doc, cmd.Params),
                ["setScribbleText"] = (ex, doc, _, cmd) => ex.ExecuteSetScribbleText(doc, cmd.Params),
                ["createValueList"] = (ex, doc, _, cmd) => ex.ExecuteCreateValueList(doc, cmd.Params),
                ["setValueListSelected"] = (ex, doc, _, cmd) => ex.ExecuteSetValueListSelected(doc, cmd.Params),
                ["createScriptNode"] = (ex, doc, _, cmd) => ex.ExecuteCreateScriptNode(doc, cmd.Params),
                ["setScriptCode"] = (ex, doc, _, cmd) => ex.ExecuteSetScriptCode(doc, cmd.Params),
                ["syncScriptParams"] = (ex, doc, _, cmd) => ex.ExecuteSyncScriptParams(doc, cmd.Params),
                ["getScriptCode"] = (ex, doc, _, cmd) => ex.ExecuteGetScriptCode(doc, cmd.Params),
                ["addScriptInput"] = (ex, doc, _, cmd) => ex.ExecuteAddScriptInput(doc, cmd.Params),
                ["removeScriptInput"] = (ex, doc, _, cmd) => ex.ExecuteRemoveScriptInput(doc, cmd.Params),
                ["addScriptOutput"] = (ex, doc, _, cmd) => ex.ExecuteAddScriptOutput(doc, cmd.Params),
                ["removeScriptOutput"] = (ex, doc, _, cmd) => ex.ExecuteRemoveScriptOutput(doc, cmd.Params),
                ["listScriptParams"] = (ex, doc, _, cmd) => ex.ExecuteListScriptParams(doc, cmd.Params),
                ["editParamProps"] = (ex, doc, _, cmd) => ex.ExecuteEditParamProps(doc, cmd.Params),
                ["beginAgentTransaction"] = (ex, doc, _, cmd) => ex.ExecuteBeginAgentTransaction(doc, cmd.Params),
                ["commitAgentTransaction"] = (ex, doc, _, cmd) => ex.ExecuteCommitAgentTransaction(doc, cmd.Params),
                ["cancelAgentTransaction"] = (ex, doc, _, cmd) => ex.ExecuteCancelAgentTransaction(doc, cmd.Params),
                ["beginRhinoAgentTransaction"] = (ex, _, rhinoDoc, cmd) => ex.ExecuteBeginRhinoAgentTransaction(rhinoDoc, cmd.Params),
                ["commitRhinoAgentTransaction"] = (ex, _, rhinoDoc, _) => ex.ExecuteCommitRhinoAgentTransaction(rhinoDoc),
                ["cancelRhinoAgentTransaction"] = (ex, _, rhinoDoc, _) => ex.ExecuteCancelRhinoAgentTransaction(rhinoDoc),
                ["setParamRhinoGeometry"] = (ex, doc, rhinoDoc, cmd) => ex.ExecuteSetParamRhinoGeometry(doc, rhinoDoc, cmd.Params),
            };
    }
}
