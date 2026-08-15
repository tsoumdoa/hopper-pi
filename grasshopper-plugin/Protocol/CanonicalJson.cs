using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;

namespace rhino_zmq_poc.Protocol
{
    internal static class CanonicalJson
    {
        private static readonly JsonSerializerOptions StringOptions = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        public static string Serialize(JsonElement value)
        {
            var builder = new StringBuilder();
            Write(value, builder);
            return builder.ToString();
        }

        public static string Sha256(JsonElement value)
        {
            var bytes = Encoding.UTF8.GetBytes(Serialize(value));
            using var sha = SHA256.Create();
            var digest = sha.ComputeHash(bytes);
            var builder = new StringBuilder(digest.Length * 2);
            foreach (var item in digest)
                builder.Append(item.ToString("x2", CultureInfo.InvariantCulture));
            return builder.ToString();
        }

        public static string Sha256(string json)
        {
            using var document = JsonDocument.Parse(json);
            return Sha256(document.RootElement);
        }

        private static void Write(JsonElement value, StringBuilder output)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.Object:
                    output.Append('{');
                    var properties = new System.Collections.Generic.List<JsonProperty>();
                    foreach (var property in value.EnumerateObject()) properties.Add(property);
                    properties.Sort((left, right) => string.CompareOrdinal(left.Name, right.Name));
                    for (var index = 0; index < properties.Count; index++)
                    {
                        if (index > 0) output.Append(',');
                        output.Append(JsonSerializer.Serialize(properties[index].Name, StringOptions));
                        output.Append(':');
                        Write(properties[index].Value, output);
                    }
                    output.Append('}');
                    return;
                case JsonValueKind.Array:
                    output.Append('[');
                    var first = true;
                    foreach (var item in value.EnumerateArray())
                    {
                        if (!first) output.Append(',');
                        first = false;
                        Write(item, output);
                    }
                    output.Append(']');
                    return;
                case JsonValueKind.String:
                    WriteString(value.GetString(), output);
                    return;
                case JsonValueKind.Number:
                    WriteNumber(value, output);
                    return;
                case JsonValueKind.True:
                    output.Append("true");
                    return;
                case JsonValueKind.False:
                    output.Append("false");
                    return;
                case JsonValueKind.Null:
                    output.Append("null");
                    return;
                default:
                    throw new InvalidDataException($"Unsupported JSON value kind {value.ValueKind}.");
            }
        }

        /// <summary>
        /// Matches ECMAScript JSON.stringify semantics so the TypeScript and C#
        /// canonical digests agree: only quote, backslash, and control characters
        /// are escaped; all other code units (including astral characters) stay
        /// raw UTF-8.
        /// </summary>
        private static void WriteString(string value, StringBuilder output)
        {
            output.Append('"');
            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '"':
                        output.Append("\\\"");
                        break;
                    case '\\':
                        output.Append("\\\\");
                        break;
                    case '\b':
                        output.Append("\\b");
                        break;
                    case '\f':
                        output.Append("\\f");
                        break;
                    case '\n':
                        output.Append("\\n");
                        break;
                    case '\r':
                        output.Append("\\r");
                        break;
                    case '\t':
                        output.Append("\\t");
                        break;
                    default:
                        if (char.IsControl(ch))
                        {
                            output.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            output.Append(ch);
                        }
                        break;
                }
            }
            output.Append('"');
        }

        private static void WriteNumber(JsonElement value, StringBuilder output)
        {
            if (value.TryGetDecimal(out var decimalValue))
            {
                if (decimalValue == 0)
                {
                    output.Append('0');
                    return;
                }
                output.Append(decimalValue.ToString("G29", CultureInfo.InvariantCulture));
                return;
            }

            var number = value.GetDouble();
            if (double.IsNaN(number) || double.IsInfinity(number))
                throw new InvalidDataException("Canonical JSON rejects non-finite numbers.");
            if (number == 0)
            {
                output.Append('0');
                return;
            }
            output.Append(number.ToString("G17", CultureInfo.InvariantCulture).Replace("E", "e"));
        }
    }
}
