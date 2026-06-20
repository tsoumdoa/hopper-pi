using System;
using System.Collections.Generic;
using System.Text.Json;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal partial class CommandExecutor
    {
        private delegate string CommandHandler(CommandExecutor executor, GH_Document doc, GhCommand command);

        private static readonly IReadOnlyDictionary<string, CommandHandler> Handlers =
            new Dictionary<string, CommandHandler>(StringComparer.Ordinal)
            {
                ["addComponent"] = (ex, doc, cmd) => ex.ExecuteAddComponent(doc, cmd.Params),
                ["deleteComponent"] = (ex, doc, cmd) => ex.ExecuteDeleteComponent(doc, cmd.Params),
                ["connectWire"] = (ex, doc, cmd) => ex.ExecuteConnectWire(doc, cmd.Params),
                ["disconnectWire"] = (ex, doc, cmd) => ex.ExecuteDisconnectWire(doc, cmd.Params),
                ["moveComponent"] = (ex, doc, cmd) => ex.ExecuteMoveComponent(doc, cmd.Params),
                ["renameComponent"] = (ex, doc, cmd) => ex.ExecuteRenameComponent(doc, cmd.Params),
                ["setComponentLocked"] = (ex, doc, cmd) => ex.ExecuteSetComponentLocked(doc, cmd.Params),
                ["setComponentHidden"] = (ex, doc, cmd) => ex.ExecuteSetComponentHidden(doc, cmd.Params),
                ["addGroup"] = (ex, doc, cmd) => ex.ExecuteAddGroup(doc, cmd.Params),
                ["removeFromGroup"] = (ex, doc, cmd) => ex.ExecuteRemoveFromGroup(doc, cmd.Params),
                ["deleteGroup"] = (ex, doc, cmd) => ex.ExecuteDeleteGroup(doc, cmd.Params),
                ["changeGroupColor"] = (ex, doc, cmd) => ex.ExecuteChangeGroupColor(doc, cmd.Params),
                ["renameGroup"] = (ex, doc, cmd) => ex.ExecuteRenameGroup(doc, cmd.Params),
                ["changeGroupStyle"] = (ex, doc, cmd) => ex.ExecuteChangeGroupStyle(doc, cmd.Params),
                ["createSlider"] = (ex, doc, cmd) => ex.ExecuteCreateSlider(doc, cmd.Params),
                ["editSliderRange"] = (ex, doc, cmd) => ex.ExecuteEditSliderRange(doc, cmd.Params),
                ["setSliderValue"] = (ex, doc, cmd) => ex.ExecuteSetSliderValue(doc, cmd.Params),
                ["createPanel"] = (ex, doc, cmd) => ex.ExecuteCreatePanel(doc, cmd.Params),
                ["setPanelParams"] = (ex, doc, cmd) => ex.ExecuteSetPanelParams(doc, cmd.Params),
                ["setPanelText"] = (ex, doc, cmd) => ex.ExecuteSetPanelText(doc, cmd.Params),
                ["createToggle"] = (ex, doc, cmd) => ex.ExecuteCreateToggle(doc, cmd.Params),
                ["setToggleValue"] = (ex, doc, cmd) => ex.ExecuteSetToggleValue(doc, cmd.Params),
                ["createSwatch"] = (ex, doc, cmd) => ex.ExecuteCreateSwatch(doc, cmd.Params),
                ["setSwatchColor"] = (ex, doc, cmd) => ex.ExecuteSetSwatchColor(doc, cmd.Params),
                ["createScribble"] = (ex, doc, cmd) => ex.ExecuteCreateScribble(doc, cmd.Params),
                ["setScribbleText"] = (ex, doc, cmd) => ex.ExecuteSetScribbleText(doc, cmd.Params),
                ["createValueList"] = (ex, doc, cmd) => ex.ExecuteCreateValueList(doc, cmd.Params),
                ["setValueListSelected"] = (ex, doc, cmd) => ex.ExecuteSetValueListSelected(doc, cmd.Params),
                ["createScriptNode"] = (ex, doc, cmd) => ex.ExecuteCreateScriptNode(doc, cmd.Params),
                ["setScriptCode"] = (ex, doc, cmd) => ex.ExecuteSetScriptCode(doc, cmd.Params),
                ["syncScriptParams"] = (ex, doc, cmd) => ex.ExecuteSyncScriptParams(doc, cmd.Params),
                ["getScriptCode"] = (ex, doc, cmd) => ex.ExecuteGetScriptCode(doc, cmd.Params),
                ["addScriptInput"] = (ex, doc, cmd) => ex.ExecuteAddScriptInput(doc, cmd.Params),
                ["removeScriptInput"] = (ex, doc, cmd) => ex.ExecuteRemoveScriptInput(doc, cmd.Params),
                ["addScriptOutput"] = (ex, doc, cmd) => ex.ExecuteAddScriptOutput(doc, cmd.Params),
                ["removeScriptOutput"] = (ex, doc, cmd) => ex.ExecuteRemoveScriptOutput(doc, cmd.Params),
                ["listScriptParams"] = (ex, doc, cmd) => ex.ExecuteListScriptParams(doc, cmd.Params),
                ["editParamProps"] = (ex, doc, cmd) => ex.ExecuteEditParamProps(doc, cmd.Params),
                ["beginAgentTransaction"] = (ex, doc, cmd) => ex.ExecuteBeginAgentTransaction(doc, cmd.Params),
                ["commitAgentTransaction"] = (ex, doc, cmd) => ex.ExecuteCommitAgentTransaction(doc, cmd.Params),
                ["cancelAgentTransaction"] = (ex, doc, cmd) => ex.ExecuteCancelAgentTransaction(doc, cmd.Params),
                ["beginRhinoAgentTransaction"] = (ex, _, cmd) => ex.ExecuteBeginRhinoAgentTransaction(cmd.Params),
                ["commitRhinoAgentTransaction"] = (ex, _, _) => ex.ExecuteCommitRhinoAgentTransaction(),
                ["cancelRhinoAgentTransaction"] = (ex, _, _) => ex.ExecuteCancelRhinoAgentTransaction(),
                ["setParamRhinoGeometry"] = (ex, doc, cmd) => ex.ExecuteSetParamRhinoGeometry(doc, cmd.Params),
            };
    }
}
