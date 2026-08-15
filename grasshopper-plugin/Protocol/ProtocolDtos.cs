using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc.Protocol
{
    internal static class HopperProtocol
    {
        public const int Version = 1;
    }

    internal sealed class BackendIdentityDto
    {
        [JsonPropertyName("backendId")]
        public string BackendId { get; set; } = "";

        [JsonPropertyName("backendStartedAt")]
        public string BackendStartedAt { get; set; } = "";

        [JsonPropertyName("pluginVersion")]
        public string PluginVersion { get; set; } = "";

        [JsonPropertyName("protocolVersion")]
        public int ProtocolVersion { get; set; } = HopperProtocol.Version;
    }

    internal sealed class GrasshopperDocumentIdentityDto
    {
        [JsonPropertyName("documentId")]
        public string DocumentId { get; set; } = "";

        [JsonPropertyName("displayName")]
        public string DisplayName { get; set; } = "";

        [JsonPropertyName("path")]
        public string Path { get; set; }
    }

    internal sealed class RhinoDocumentIdentityDto
    {
        [JsonPropertyName("documentId")]
        public string DocumentId { get; set; } = "";

        [JsonPropertyName("runtimeSerialNumber")]
        public uint RuntimeSerialNumber { get; set; }

        [JsonPropertyName("displayName")]
        public string DisplayName { get; set; } = "";

        [JsonPropertyName("path")]
        public string Path { get; set; }
    }

    internal sealed class BackendDocumentsDto
    {
        [JsonPropertyName("grasshopper")]
        public GrasshopperDocumentIdentityDto Grasshopper { get; set; }

        [JsonPropertyName("rhino")]
        public RhinoDocumentIdentityDto Rhino { get; set; }
    }

    internal sealed class HopperErrorDto
    {
        [JsonPropertyName("code")]
        public string Code { get; set; } = "";

        [JsonPropertyName("message")]
        public string Message { get; set; } = "";

        [JsonPropertyName("retryable")]
        public bool Retryable { get; set; }

        [JsonPropertyName("details")]
        public JsonElement? Details { get; set; }
    }

    internal class WireRequestDto<TBody>
    {
        [JsonPropertyName("protocolVersion")]
        public int ProtocolVersion { get; set; } = HopperProtocol.Version;

        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; } = "";

        [JsonPropertyName("issuedAt")]
        public string IssuedAt { get; set; } = "";

        [JsonPropertyName("body")]
        public TBody Body { get; set; }

        [JsonPropertyName("token")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string Token { get; set; }
    }

    internal class WireResponseDto<TData>
    {
        [JsonPropertyName("protocolVersion")]
        public int ProtocolVersion { get; set; } = HopperProtocol.Version;

        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; } = "";

        [JsonPropertyName("backend")]
        public BackendIdentityDto Backend { get; set; }

        [JsonPropertyName("documents")]
        public BackendDocumentsDto Documents { get; set; }

        [JsonPropertyName("outcome")]
        public string Outcome { get; set; } = "";

        [JsonPropertyName("startedAt")]
        public string StartedAt { get; set; }

        [JsonPropertyName("completedAt")]
        public string CompletedAt { get; set; }

        [JsonPropertyName("data")]
        public TData Data { get; set; }

        [JsonPropertyName("error")]
        public HopperErrorDto Error { get; set; }
    }

    internal sealed class EmptyBodyDto
    {
    }

    internal sealed class BackendInfoDataDto
    {
        [JsonPropertyName("capabilities")]
        public List<string> Capabilities { get; set; } = new List<string>();

        [JsonPropertyName("maxRequestBytes")]
        public int MaxRequestBytes { get; set; }

        [JsonPropertyName("maxCheckpointBytes")]
        public int MaxCheckpointBytes { get; set; }

        [JsonPropertyName("deduplicationWindowMs")]
        public long DeduplicationWindowMs { get; set; }
    }

    internal sealed class GetRequestStatusBodyDto
    {
        [JsonPropertyName("targetRequestId")]
        public string TargetRequestId { get; set; } = "";

        [JsonPropertyName("payloadSha256")]
        public string PayloadSha256 { get; set; } = "";
    }

    internal sealed class RequestStatusDataDto
    {
        [JsonPropertyName("targetRequestId")]
        public string TargetRequestId { get; set; } = "";

        [JsonPropertyName("state")]
        public string State { get; set; } = "";

        [JsonPropertyName("cachedResponse")]
        public WireResponseDto<JsonElement>? CachedResponse { get; set; }
    }

    internal sealed class ExecuteActionsRequestDto : WireRequestDto<JsonElement>
    {
        [JsonPropertyName("payloadSha256")]
        public string PayloadSha256 { get; set; } = "";
    }
}
