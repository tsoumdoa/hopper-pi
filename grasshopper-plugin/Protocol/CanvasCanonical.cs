using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc.Protocol
{
    internal sealed class CanonicalCanvasObjectDto
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("typeId")]
        public string TypeId { get; set; } = "";

        [JsonPropertyName("kind")]
        public string Kind { get; set; } = "";

        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }

        [JsonPropertyName("properties")]
        public Dictionary<string, JsonElement> Properties { get; set; } = new Dictionary<string, JsonElement>();
    }

    internal sealed class CanonicalWireDto
    {
        [JsonPropertyName("fromObjectId")]
        public string FromObjectId { get; set; } = "";

        [JsonPropertyName("fromPort")]
        public string FromPort { get; set; } = "";

        [JsonPropertyName("toObjectId")]
        public string ToObjectId { get; set; } = "";

        [JsonPropertyName("toPort")]
        public string ToPort { get; set; } = "";
    }

    internal sealed class CanonicalGroupDto
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("memberIds")]
        public List<string> MemberIds { get; set; } = new List<string>();

        [JsonPropertyName("properties")]
        public Dictionary<string, JsonElement> Properties { get; set; } = new Dictionary<string, JsonElement>();
    }

    internal sealed class CanonicalCanvasDto
    {
        [JsonPropertyName("objects")]
        public List<CanonicalCanvasObjectDto> Objects { get; set; } = new List<CanonicalCanvasObjectDto>();

        [JsonPropertyName("wires")]
        public List<CanonicalWireDto> Wires { get; set; } = new List<CanonicalWireDto>();

        [JsonPropertyName("groups")]
        public List<CanonicalGroupDto> Groups { get; set; } = new List<CanonicalGroupDto>();
    }

    internal sealed class CanvasCheckpointEnvelopeDto
    {
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; set; } = 1;

        [JsonPropertyName("checkpointId")]
        public string CheckpointId { get; set; } = "";

        [JsonPropertyName("backendId")]
        public string BackendId { get; set; } = "";

        [JsonPropertyName("grasshopperDocumentId")]
        public string GrasshopperDocumentId { get; set; } = "";

        [JsonPropertyName("capturedAt")]
        public string CapturedAt { get; set; } = "";

        [JsonPropertyName("encoding")]
        public string Encoding { get; set; } = "base64";

        [JsonPropertyName("compression")]
        public string Compression { get; set; } = "none";

        [JsonPropertyName("bytes")]
        public string Bytes { get; set; } = "";

        [JsonPropertyName("byteLength")]
        public int ByteLength { get; set; }

        [JsonPropertyName("binarySha256")]
        public string BinarySha256 { get; set; } = "";

        [JsonPropertyName("canvasDigest")]
        public string CanvasDigest { get; set; } = "";

        [JsonPropertyName("canonicalCanvas")]
        public CanonicalCanvasDto CanonicalCanvas { get; set; }
    }

    internal sealed class RestoreCheckpointDataDto
    {
        [JsonPropertyName("restoredCheckpointId")]
        public string RestoredCheckpointId { get; set; } = "";

        [JsonPropertyName("previousCanvasDigest")]
        public string PreviousCanvasDigest { get; set; } = "";

        [JsonPropertyName("currentCanvasDigest")]
        public string CurrentCanvasDigest { get; set; } = "";

        [JsonPropertyName("grasshopperUndoRecorded")]
        public bool GrasshopperUndoRecorded { get; set; }
    }

    internal static class CanvasCanonical
    {
        public static CanonicalCanvasDto Sort(CanonicalCanvasDto canvas)
        {
            canvas.Objects.Sort((left, right) => string.CompareOrdinal(left.Id, right.Id));
            canvas.Wires.Sort((left, right) => string.CompareOrdinal(WireKey(left), WireKey(right)));
            canvas.Groups.Sort((left, right) => string.CompareOrdinal(left.Id, right.Id));
            foreach (var group in canvas.Groups)
                group.MemberIds.Sort(StringComparer.Ordinal);
            return canvas;
        }

        public static string Digest(CanonicalCanvasDto canvas)
        {
            var sorted = Sort(canvas);
            var json = JsonSerializer.Serialize(sorted);
            return CanonicalJson.Sha256(json);
        }

        public static string Sha256(byte[] bytes)
        {
            using var sha = SHA256.Create();
            var digest = sha.ComputeHash(bytes);
            var builder = new System.Text.StringBuilder(digest.Length * 2);
            foreach (var item in digest)
                builder.Append(item.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
            return builder.ToString();
        }

        public static byte[] DecodeAndValidate(CanvasCheckpointEnvelopeDto envelope, int maxBytes)
        {
            if (envelope == null)
                throw new HopperRequestException("invalid_input", "A checkpoint envelope is required.");
            if (envelope.SchemaVersion != 1)
                throw new HopperRequestException("invalid_input", "Unsupported checkpoint schemaVersion.");
            if (!string.Equals(envelope.Encoding, "base64", StringComparison.Ordinal))
                throw new HopperRequestException("invalid_input", "Checkpoint encoding must be base64.");
            if (!string.Equals(envelope.Compression, "none", StringComparison.Ordinal))
                throw new HopperRequestException("invalid_input", "The plugin only accepts uncompressed checkpoints.");
            if (string.IsNullOrEmpty(envelope.Bytes))
                throw new HopperRequestException("invalid_input", "Checkpoint bytes are required.");

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(envelope.Bytes);
            }
            catch (FormatException)
            {
                throw new HopperRequestException("invalid_input", "Checkpoint bytes are not valid base64.");
            }

            if (bytes.Length != envelope.ByteLength)
                throw new HopperRequestException("invalid_input", "Checkpoint byteLength does not match the payload.");
            if (bytes.Length == 0 || bytes.Length > maxBytes)
                throw new HopperRequestException("invalid_input", "Checkpoint payload is empty or exceeds the size limit.");
            if (!string.Equals(Sha256(bytes), envelope.BinarySha256, StringComparison.Ordinal))
                throw new HopperRequestException("invalid_input", "Checkpoint binarySha256 does not match the payload.");
            return bytes;
        }

        private static string WireKey(CanonicalWireDto wire) =>
            $"{wire.FromObjectId}\0{wire.FromPort}\0{wire.ToObjectId}\0{wire.ToPort}";
    }
}
