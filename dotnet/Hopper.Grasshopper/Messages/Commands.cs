using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    internal class Position
    {
        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }
    }

    internal class AddComponentParams
    {
        [JsonPropertyName("typeGuid")]
        public string TypeGuid { get; set; }

        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("preview")]
        public bool Preview { get; set; } = false;
    }

    internal class DeleteComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    internal class ConnectWireParams
    {
        [JsonPropertyName("from")]
        public PortRef From { get; set; }

        [JsonPropertyName("to")]
        public PortRef To { get; set; }
    }

    internal class DisconnectWireParams
    {
        [JsonPropertyName("from")]
        public PortRef From { get; set; }

        [JsonPropertyName("to")]
        public PortRef To { get; set; }
    }

    internal class MoveComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("position")]
        public Position Position { get; set; }
    }

    internal class RenameComponentParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }
    }

    internal class SetComponentLockedParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("locked")]
        public bool Locked { get; set; }
    }

    internal class SetComponentHiddenParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("hidden")]
        public bool Hidden { get; set; }
    }

    internal class AddGroupParams
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

    internal class RemoveFromGroupParams
    {
        [JsonPropertyName("componentIds")]
        public string[] ComponentIds { get; set; }

        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }
    }

    internal class DeleteGroupParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }
    }

    internal class ChangeGroupColorParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; } = "rgba(255,255,255,150)";
    }

    internal class RenameGroupParams
    {
        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    internal class ChangeGroupStyleParams
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

    internal class SetSliderValueParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("value")]
        public double Value { get; set; }
    }

    internal class CreateSliderParams
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

    internal class EditSliderRangeParams
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

    internal class SetPanelTextParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
    }

    internal class CreatePanelParams
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

    internal class SetPanelParams
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

    internal class CreateToggleParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("value")]
        public bool Value { get; set; }
    }

    internal class SetToggleValueParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("value")]
        public bool Value { get; set; }
    }

    internal class CreateSwatchParams
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; }

        [JsonPropertyName("nickName")]
        public string NickName { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }
    }

    internal class SetSwatchColorParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }
    }

    internal class CreateScribbleParams
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

    internal class SetScribbleTextParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
    }

    internal class CreateValueListItem
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("value")]
        public string Value { get; set; }
    }

    internal class CreateValueListParams
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

    internal class SetValueListSelectedParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("selectedIndex")]
        public int SelectedIndex { get; set; }
    }

    internal class ScriptIOParam
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

    internal class CreateScriptNodeParams
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

    internal class SetScriptCodeParams
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

    internal class SyncScriptParamsParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("inputs")]
        public List<ScriptIOParam> Inputs { get; set; }

        [JsonPropertyName("outputs")]
        public List<ScriptIOParam> Outputs { get; set; }
    }

    internal class GetScriptCodeParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    internal class AddScriptInputParams
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

    internal class RemoveScriptInputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    internal class AddScriptOutputParams
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

    internal class RemoveScriptOutputParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    internal class ListScriptParamsParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    internal class EditParamPropsParams
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

    internal class PortRef
    {
        [JsonPropertyName("componentId")]
        public string ComponentId { get; set; }

        [JsonPropertyName("port")]
        public string Port { get; set; }
    }

    internal class GhCommand
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("params")]
        public JsonElement Params { get; set; }
    }

    internal class SubmitJobRequest
    {
        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("token")]
        public string Token { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("command")]
        public GhCommand Command { get; set; }
    }

    internal class BeginAgentTransactionParams
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }
    }
}
