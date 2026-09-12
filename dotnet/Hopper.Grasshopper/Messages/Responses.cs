using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    internal class ListScriptParamsResponse
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

    internal class ScriptParamInfo
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

    internal class GetScriptCodeResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "getScriptCode.response";
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
        [JsonPropertyName("code")]
        public string Code { get; set; }
    }

    internal class GhComponentInfo
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

    internal class ListAllComponentsResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "listAllComponents.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("components")]
        public List<GhComponentInfo> Components { get; set; }
    }

    internal class GetCurrentCanvasResponse
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

    internal class CanvasError
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

    internal class GetCanvasErrorsResponse
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
}
