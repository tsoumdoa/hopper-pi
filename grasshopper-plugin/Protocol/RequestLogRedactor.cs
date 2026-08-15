using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace rhino_zmq_poc.Protocol
{
    internal static class RequestLogRedactor
    {
        public static string Redact(string json)
        {
            try
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return "{\"invalidRequest\":true}";

                var record = new Dictionary<string, object>();
                CopyScalar(root, record, "protocolVersion");
                CopyScalar(root, record, "type");
                CopyScalar(root, record, "requestId");
                CopyScalar(root, record, "issuedAt");
                CopyScalar(root, record, "payloadSha256");
                if (root.TryGetProperty("body", out var body) && body.ValueKind == JsonValueKind.Object)
                {
                    var keys = body.EnumerateObject().Select(item => item.Name)
                        .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                    var bodyMetadata = new Dictionary<string, object>
                    {
                        ["keys"] = keys,
                        ["byteLength"] = Encoding.UTF8.GetByteCount(body.GetRawText())
                    };
                    if (body.TryGetProperty("actions", out var actions) && actions.ValueKind == JsonValueKind.Array)
                        bodyMetadata["actionCount"] = actions.GetArrayLength();
                    record["body"] = bodyMetadata;
                }
                else
                {
                    record["byteLength"] = Encoding.UTF8.GetByteCount(json);
                }
                return JsonSerializer.Serialize(record);
            }
            catch
            {
                return "{\"invalidRequest\":true}";
            }
        }

        private static void CopyScalar(JsonElement source, IDictionary<string, object> target, string name)
        {
            if (!source.TryGetProperty(name, out var value)) return;
            if (value.ValueKind == JsonValueKind.String) target[name] = value.GetString();
            else if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)) target[name] = number;
        }
    }
}
