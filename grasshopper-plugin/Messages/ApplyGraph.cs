using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    internal class ApplyGraphComponentSpec
    {
        [JsonPropertyName("ref")]
        public string Ref { get; set; }

        [JsonPropertyName("typeGuid")]
        public string TypeGuid { get; set; }

        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("preview")]
        public bool Preview { get; set; }
    }

    internal class ApplyGraphWidgetSpec
    {
        [JsonPropertyName("ref")]
        public string Ref { get; set; }

        [JsonPropertyName("kind")]
        public string Kind { get; set; }

        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("min")]
        public double Min { get; set; }

        [JsonPropertyName("max")]
        public double Max { get; set; }

        [JsonPropertyName("value")]
        public JsonElement Value { get; set; }

        [JsonPropertyName("digits")]
        public int? Digits { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }

        [JsonPropertyName("textOutput")]
        public string TextOutput { get; set; }

        [JsonPropertyName("width")]
        public double? Width { get; set; }

        [JsonPropertyName("height")]
        public double? Height { get; set; }

        [JsonPropertyName("bgColor")]
        public string BgColor { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }

        [JsonPropertyName("size")]
        public double? Size { get; set; }

        [JsonPropertyName("items")]
        public List<CreateValueListItem> Items { get; set; }

        [JsonPropertyName("selectedIndex")]
        public int? SelectedIndex { get; set; }
    }

    internal class ApplyGraphScriptSpec
    {
        [JsonPropertyName("ref")]
        public string Ref { get; set; }

        [JsonPropertyName("language")]
        public string Language { get; set; }

        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("code")]
        public string Code { get; set; }

        [JsonPropertyName("inputs")]
        public List<ScriptIOParam> Inputs { get; set; }

        [JsonPropertyName("outputs")]
        public List<ScriptIOParam> Outputs { get; set; }
    }

    internal class ApplyGraphEndpoint
    {
        [JsonPropertyName("ref")]
        public string Ref { get; set; }

        [JsonPropertyName("port")]
        public JsonElement Port { get; set; }
    }

    internal class ApplyGraphWireSpec
    {
        [JsonPropertyName("from")]
        public JsonElement FromTuple { get; set; }

        [JsonPropertyName("to")]
        public JsonElement ToTuple { get; set; }
    }

    internal class ApplyGraphGroupSpec
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("refs")]
        public List<string> Refs { get; set; }

        [JsonPropertyName("color")]
        public string Color { get; set; }

        [JsonPropertyName("border")]
        public string Border { get; set; }
    }

    internal class ApplyGraphRequest
    {
        [JsonPropertyName("components")]
        public List<ApplyGraphComponentSpec> Components { get; set; } = new List<ApplyGraphComponentSpec>();

        [JsonPropertyName("widgets")]
        public List<ApplyGraphWidgetSpec> Widgets { get; set; } = new List<ApplyGraphWidgetSpec>();

        [JsonPropertyName("scripts")]
        public List<ApplyGraphScriptSpec> Scripts { get; set; } = new List<ApplyGraphScriptSpec>();

        [JsonPropertyName("wires")]
        public List<ApplyGraphWireSpec> Wires { get; set; } = new List<ApplyGraphWireSpec>();

        [JsonPropertyName("groups")]
        public List<ApplyGraphGroupSpec> Groups { get; set; } = new List<ApplyGraphGroupSpec>();
    }

    internal class ApplyGraphCounts
    {
        [JsonPropertyName("components")]
        public int Components { get; set; }

        [JsonPropertyName("widgets")]
        public int Widgets { get; set; }

        [JsonPropertyName("scripts")]
        public int Scripts { get; set; }

        [JsonPropertyName("wires")]
        public int Wires { get; set; }

        [JsonPropertyName("groups")]
        public int Groups { get; set; }
    }

    internal class ApplyGraphStructuralError
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("code")]
        public string Code { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; }

        [JsonPropertyName("candidates")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string> Candidates { get; set; }
    }

    internal class ApplyGraphResponse
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "applyGraph.response";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("rolledBack")]
        public bool RolledBack { get; set; }

        [JsonPropertyName("counts")]
        public ApplyGraphCounts Counts { get; set; } = new ApplyGraphCounts();

        [JsonPropertyName("refs")]
        public Dictionary<string, string> Refs { get; set; } = new Dictionary<string, string>();

        [JsonPropertyName("structuralErrors")]
        public List<ApplyGraphStructuralError> StructuralErrors { get; set; } = new List<ApplyGraphStructuralError>();

        [JsonPropertyName("elapsedMs")]
        public long ElapsedMs { get; set; }
    }
}
