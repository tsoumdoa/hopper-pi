using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
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

    public class PingResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "ping.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
    }

    public class AuthErrorResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "auth.error";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
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

    public class RhinoObjectInfoDto
    {
        [JsonPropertyName("objectId")]
        public string ObjectId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("layer")]
        public string Layer { get; set; }

        [JsonPropertyName("objectType")]
        public string ObjectType { get; set; }
    }

    public class QueryRhinoObjectsResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "queryRhinoObjects.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("objects")]
        public List<RhinoObjectInfoDto> Objects { get; set; }
    }
}
