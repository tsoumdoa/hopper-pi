using System;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    internal class GhJobStatus
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

    internal class GhEventXml
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
}
