using System.Collections.Generic;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Canonical list of command actions handled by <see cref="CommandExecutor"/>.
    /// Keep in sync with TypeScript CommandAction in src/types/commands.ts.
    /// </summary>
    public static class CommandActionRegistry
    {
        public static IReadOnlyList<string> KnownActions { get; } = new[]
        {
            "addComponent",
            "deleteComponent",
            "connectWire",
            "disconnectWire",
            "moveComponent",
            "renameComponent",
            "setComponentLocked",
            "setComponentHidden",
            "addGroup",
            "removeFromGroup",
            "deleteGroup",
            "changeGroupColor",
            "renameGroup",
            "changeGroupStyle",
            "createSlider",
            "editSliderRange",
            "setSliderValue",
            "createPanel",
            "setPanelParams",
            "setPanelText",
            "createToggle",
            "setToggleValue",
            "createSwatch",
            "setSwatchColor",
            "createScribble",
            "setScribbleText",
            "createValueList",
            "setValueListSelected",
            "createScriptNode",
            "setScriptCode",
            "syncScriptParams",
            "getScriptCode",
            "addScriptInput",
            "removeScriptInput",
            "addScriptOutput",
            "removeScriptOutput",
            "listScriptParams",
            "editParamProps",
            "beginAgentTransaction",
            "commitAgentTransaction",
            "cancelAgentTransaction",
            "beginRhinoAgentTransaction",
            "commitRhinoAgentTransaction",
            "cancelRhinoAgentTransaction",
            "setParamRhinoGeometry",
        };
    }
}
