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
        [JsonPropertyName("guid")]
        public string Guid { get; set; }

        [JsonPropertyName("position")]
        public Position Position { get; set; }
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
    }

    public class RemoveFromGroupParams
    {
        [JsonPropertyName("componentIds")]
        public string[] ComponentIds { get; set; }

        [JsonPropertyName("groupName")]
        public string GroupName { get; set; }
    }

    public class SetSliderValueParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("value")]
        public double Value { get; set; }
    }

    public class SetPanelTextParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }
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
    }
}
