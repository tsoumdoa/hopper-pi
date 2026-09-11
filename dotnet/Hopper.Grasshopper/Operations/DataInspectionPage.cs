using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;

namespace rhino_zmq_poc
{
    internal sealed record InspectionRequest
    {
        public string TargetId { get; init; }
        public string Mode { get; init; } = "summary";
        public string Side { get; init; } = "both";
        public int? BranchIndex { get; init; }
        public int Offset { get; init; }
        public string DocumentRevision { get; init; }
        public string TargetRevision { get; init; }
    }

    internal static class DataInspectionPage
    {
        internal const int MaxBytes = 8192;
        internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

        internal static string Cursor(InspectionRequest request) =>
            Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions));

        internal static InspectionRequest ReadCursor(string cursor)
        {
            try
            {
                if (string.IsNullOrEmpty(cursor) || cursor.Length > 2048) throw new FormatException();
                var request = JsonSerializer.Deserialize<InspectionRequest>(Convert.FromBase64String(cursor), JsonOptions);
                if (string.IsNullOrEmpty(request?.DocumentRevision) || string.IsNullOrEmpty(request.TargetRevision))
                    throw new FormatException();
                return request;
            }
            catch (Exception ex) when (ex is FormatException or JsonException)
            {
                throw new ArgumentException("Invalid inspection cursor. Start a new inspection.");
            }
        }

        internal static void ValidateRevision(InspectionRequest request, string documentRevision, string targetRevision)
        {
            if (request.DocumentRevision != documentRevision || request.TargetRevision != targetRevision)
                throw new InvalidOperationException("Stale inspection cursor: document or solution changed. Start a new inspection.");
        }

        // Read only enough rows for one page. Include cursor/metadata in the byte budget.
        internal static string Build(InspectionRequest request, int total, int limit,
            Dictionary<string, object> response, Func<int, object> readRow)
        {
            if (request.Offset < 0 || request.Offset > total)
                throw new ArgumentException("offset is outside the available rows.");
            if (limit < 1 || limit > 100) throw new ArgumentException("limit must be between 1 and 100.");
            var rows = new List<object>();
            response["type"] = "getData.response";
            response["targetId"] = request.TargetId;
            response["mode"] = request.Mode;
            response["offset"] = request.Offset;
            response["totalRows"] = total;
            response["rows"] = rows;

            string Serialize()
            {
                int next = request.Offset + rows.Count;
                response["returnedRows"] = rows.Count;
                response["hasMore"] = next < total;
                response["nextCursor"] = next < total ? Cursor(request with { Offset = next }) : null;
                return JsonSerializer.Serialize(response, JsonOptions);
            }

            var json = Serialize();
            if (Encoding.UTF8.GetByteCount(json) > MaxBytes)
                throw new InvalidOperationException("Inspection metadata exceeds the response budget.");
            int count = Math.Min(limit, total - request.Offset);
            for (int i = 0; i < count; i++)
            {
                rows.Add(readRow(request.Offset + i));
                var candidate = Serialize();
                if (Encoding.UTF8.GetByteCount(candidate) > MaxBytes)
                {
                    rows.RemoveAt(rows.Count - 1);
                    if (rows.Count == 0)
                        throw new InvalidOperationException("Inspection row exceeds the response budget.");
                    break;
                }
                json = candidate;
            }
            return json;
        }
    }
}
