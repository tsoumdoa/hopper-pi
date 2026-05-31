using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    public class Position
    {
        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }
    }

    public class AddComponentParams
    {
        [JsonPropertyName("typeGuid")]
        public string TypeGuid { get; set; }

        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("preview")]
        public bool Preview { get; set; } = false;
    }

    public class DeleteComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    public class ConnectWireParams
    {
        [JsonPropertyName("from")]
        public PortRef From { get; set; }

        [JsonPropertyName("to")]
        public PortRef To { get; set; }
    }

    public class DisconnectWireParams
    {
        [JsonPropertyName("from")]
        public PortRef From { get; set; }

        [JsonPropertyName("to")]
        public PortRef To { get; set; }
    }

    public class MoveComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("position")]
        public Position Position { get; set; }
    }

    public class RenameComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }
    }

    public class SetComponentLockedParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("locked")]
        public bool Locked { get; set; }
    }

    public class SetComponentHiddenParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("hidden")]
        public bool Hidden { get; set; }
    }

    public class AddGroupParams
    {
        [JsonPropertyName("componentIds")]
        public string[] ComponentIds { get; set; }

        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; } = "rgba(255,255,255,150)";

        [JsonPropertyName("border")]
        public string Border { get; set; }
    }

    public class RemoveFromGroupParams
    {
        [JsonPropertyName("componentIds")]
        public string[] ComponentIds { get; set; }

        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }
    }

    public class DeleteGroupParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }
    }

    public class ChangeGroupColorParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; } = "rgba(255,255,255,150)";
    }

    public class RenameGroupParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    public class ChangeGroupStyleParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("border")]
        public string Border { get; set; }
    }

    public class SetSliderValueParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("value")]
        public double Value { get; set; }
    }

    public class CreateSliderParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("min")]
        public double Min { get; set; }

        [JsonPropertyName("max")]
        public double Max { get; set; }

        [JsonPropertyName("value")]
        public double Value { get; set; }

        [JsonPropertyName("digits")]
        public int Digits { get; set; }

        [JsonPropertyName("interval")]
        public double Interval { get; set; }
    }

    public class EditSliderRangeParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("min")]
        public double Min { get; set; }

        [JsonPropertyName("max")]
        public double Max { get; set; }

        [JsonPropertyName("digits")]
        public int Digits { get; set; }

        [JsonPropertyName("interval")]
        public double Interval { get; set; }
    }

    public class SetPanelTextParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
    }

    public class CreatePanelParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }

        [JsonPropertyName("width")]
        public double? Width { get; set; }

        [JsonPropertyName("height")]
        public double? Height { get; set; }

        [JsonPropertyName("textOutput")]
        public string TextOutput { get; set; }

        [JsonPropertyName("bgColor")]
        public string BgColor { get; set; }
    }

    public class SetPanelParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("textOutput")]
        public string TextOutput { get; set; }

        [JsonPropertyName("width")]
        public double? Width { get; set; }

        [JsonPropertyName("height")]
        public double? Height { get; set; }

        [JsonPropertyName("bgColor")]
        public string BgColor { get; set; }
    }

    public class CreateToggleParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("value")]
        public bool Value { get; set; }
    }

    public class SetToggleValueParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("value")]
        public bool Value { get; set; }
    }

    public class CreateSwatchParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }
    }

    public class SetSwatchColorParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }
    }

    public class CreateScribbleParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }

        [JsonPropertyName("size")]
        public double? Size { get; set; }
    }

    public class SetScribbleTextParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
    }

    public class CreateValueListItem
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("value")]
        public string Value { get; set; }
    }

    public class CreateValueListParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("items")]
        public CreateValueListItem[] Items { get; set; }

        [JsonPropertyName("selectedIndex")]
        public int? SelectedIndex { get; set; }
    }

    public class SetValueListSelectedParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("selectedIndex")]
        public int SelectedIndex { get; set; }
    }

    public class ScriptIOParam
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("access")]
        public string Access { get; set; }

        [JsonPropertyName("dataMapping")]
        public string DataMapping { get; set; }

        [JsonPropertyName("simplify")]
        public bool? Simplify { get; set; }

        [JsonPropertyName("reverse")]
        public bool? Reverse { get; set; }

        [JsonPropertyName("typeHint")]
        public string TypeHint { get; set; }

        [JsonPropertyName("previousName")]
        public string PreviousName { get; set; }
    }

    public class CreateScriptNodeParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("language")]
        public string Language { get; set; }

        [JsonPropertyName("code")]
        public string Code { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("inputs")]
        public List<ScriptIOParam> Inputs { get; set; }

        [JsonPropertyName("outputs")]
        public List<ScriptIOParam> Outputs { get; set; }
    }

    public class SetScriptCodeParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("code")]
        public string Code { get; set; }

        [JsonPropertyName("inputs")]
        public List<ScriptIOParam> Inputs { get; set; }

        [JsonPropertyName("outputs")]
        public List<ScriptIOParam> Outputs { get; set; }
    }

    public class SyncScriptParamsParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("inputs")]
        public List<ScriptIOParam> Inputs { get; set; }

        [JsonPropertyName("outputs")]
        public List<ScriptIOParam> Outputs { get; set; }
    }

    public class GetScriptCodeParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    public class AddScriptInputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("access")]
        public string Access { get; set; }

        [JsonPropertyName("dataMapping")]
        public string DataMapping { get; set; }

        [JsonPropertyName("simplify")]
        public bool? Simplify { get; set; }

        [JsonPropertyName("reverse")]
        public bool? Reverse { get; set; }

        [JsonPropertyName("typeHint")]
        public string TypeHint { get; set; }
    }

    public class RemoveScriptInputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    public class AddScriptOutputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("dataMapping")]
        public string DataMapping { get; set; }

        [JsonPropertyName("simplify")]
        public bool? Simplify { get; set; }

        [JsonPropertyName("reverse")]
        public bool? Reverse { get; set; }

        [JsonPropertyName("typeHint")]
        public string TypeHint { get; set; }
    }

    public class RemoveScriptOutputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    public class ListScriptParamsParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    public class ListScriptParamsResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "listScriptParams.response";
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
        [JsonPropertyName("inputs")]
        public List<ScriptParamInfo> Inputs { get; set; } = new();
        [JsonPropertyName("outputs")]
        public List<ScriptParamInfo> Outputs { get; set; } = new();
    }

    public class ScriptParamInfo
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }
        [JsonPropertyName("access")]
        public string Access { get; set; }
        [JsonPropertyName("dataMapping")]
        public string DataMapping { get; set; }
        [JsonPropertyName("simplify")]
        public bool Simplify { get; set; }
        [JsonPropertyName("reverse")]
        public bool Reverse { get; set; }

        [JsonPropertyName("typeHint")]
        public string TypeHint { get; set; }
    }

    public class GetScriptCodeResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "getScriptCode.response";
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
        [JsonPropertyName("code")]
        public string Code { get; set; }
    }

    public class EditParamPropsParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("access")]
        public string Access { get; set; }

        [JsonPropertyName("dataMapping")]
        public string DataMapping { get; set; }

        [JsonPropertyName("simplify")]
        public bool? Simplify { get; set; }

        [JsonPropertyName("reverse")]
        public bool? Reverse { get; set; }

        [JsonPropertyName("typeHint")]
        public string TypeHint { get; set; }
    }

    public class PortRef
    {
        [JsonPropertyName("componentId")]
        public string ComponentId { get; set; }

        [JsonPropertyName("port")]
        public string Port { get; set; }
    }

    public class GhCommand
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("params")]
        public JsonElement Params { get; set; }
    }

    public class SubmitJobRequest
    {
        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("command")]
        public GhCommand Command { get; set; }
    }

    public class GhJobStatus
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "gh.job.status";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("commandId")]
        public string CommandId { get; set; }

        [JsonPropertyName("state")]
        public string State { get; set; }

        [JsonPropertyName("progress")]
        public int Progress { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class GhEventXml
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "gh.event.xml";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("docName")]
        public string DocName { get; set; }

        [JsonPropertyName("xml")]
        public string Xml { get; set; }
    }

    public class CommandResult
    {
        [JsonPropertyName("executed")]
        public bool Executed { get; set; }

        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("output")]
        public string Output { get; set; }

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
    }

    public class GhComponentInfo
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("typeGuid")]
        public string Guid { get; set; }

        [JsonPropertyName("pluginName")]
        public string PluginName { get; set; }

        [JsonPropertyName("assemblyName")]
        public string AssemblyName { get; set; }

        [JsonPropertyName("category")]
        public string Category { get; set; }

        [JsonPropertyName("subcategory")]
        public string SubCategory { get; set; }

        [JsonPropertyName("description")]
        public string Description { get; set; }
    }

    public class ListAllComponentsResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "listAllComponents.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("components")]
        public List<GhComponentInfo> Components { get; set; }
    }

    public class GetCurrentCanvasResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "getCurrentCanvas.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("docName")]
        public string DocName { get; set; }

        [JsonPropertyName("xml")]
        public string Xml { get; set; }

        [JsonPropertyName("selectedInstanceGuids")]
        public List<string> SelectedInstanceGuids { get; set; }
    }

    public class CanvasError
    {
        [JsonPropertyName("componentId")]
        public string ComponentId { get; set; }

        [JsonPropertyName("componentNickName")]
        public string ComponentNickName { get; set; }

        [JsonPropertyName("level")]
        public string Level { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
    }

    public class GetCanvasErrorsResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "getCanvasErrors.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("docName")]
        public string DocName { get; set; }

        [JsonPropertyName("errors")]
        public List<CanvasError> Errors { get; set; }
    }

    public class BeginAgentTransactionParams
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    public class RunRhinoScriptRequest
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "runRhinoScript";

        [JsonPropertyName("mode")]
        public string Mode { get; set; }

        [JsonPropertyName("source")]
        public string Source { get; set; }

        [JsonPropertyName("echo")]
        public bool Echo { get; set; }
    }

    public class RunRhinoScriptResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "runRhinoScript.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("output")]
        public string Output { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }
}
