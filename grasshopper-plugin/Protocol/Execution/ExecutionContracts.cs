using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc.Protocol.Execution
{
    internal static class ExecutionOutcomes
    {
        public const string Succeeded = "succeeded";
        public const string Failed = "failed";
        public const string Partial = "partial";
        public const string Unknown = "unknown";
        public const string Skipped = "skipped";
    }

    internal static class TransactionOutcomes
    {
        public const string Committed = "committed";
        public const string RolledBack = "rolled_back";
        public const string Unchanged = "unchanged";
        public const string Partial = "partial";
        public const string Unknown = "unknown";
    }

    internal static class MutationScopes
    {
        public const string Viewport = "viewport";
        public const string Grasshopper = "grasshopper";
        public const string Rhino = "rhino";
        public const string Mixed = "mixed";

        public static bool IsValid(string scope) =>
            scope == Viewport || scope == Grasshopper || scope == Rhino || scope == Mixed;
    }

    internal sealed class HopperError
    {
        [JsonPropertyName("code")]
        public string Code { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; }

        [JsonPropertyName("retryable")]
        public bool Retryable { get; set; }

        [JsonPropertyName("details")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public object Details { get; set; }
    }

    internal sealed class LowLevelCommand
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("params")]
        public JsonElement Parameters { get; set; }
    }

    internal sealed class BackendAction
    {
        [JsonPropertyName("kind")]
        public string Kind { get; set; }

        [JsonPropertyName("command")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public LowLevelCommand Command { get; set; }

        [JsonPropertyName("input")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public JsonElement Input { get; set; }
    }

    internal sealed class ExecuteActionsRequest
    {
        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("payloadSha256")]
        public string PayloadSha256 { get; set; }

        [JsonPropertyName("expectedBackendId")]
        public string ExpectedBackendId { get; set; }

        [JsonPropertyName("expectedGrasshopperDocumentId")]
        public string ExpectedGrasshopperDocumentId { get; set; }

        [JsonPropertyName("expectedRhinoDocumentId")]
        public string ExpectedRhinoDocumentId { get; set; }

        [JsonPropertyName("expectedCanvasDigest")]
        public string ExpectedCanvasDigest { get; set; }

        [JsonPropertyName("transactionName")]
        public string TransactionName { get; set; }

        [JsonPropertyName("scope")]
        public string Scope { get; set; }

        [JsonPropertyName("actions")]
        public List<BackendAction> Actions { get; set; } = new List<BackendAction>();
    }

    internal sealed class ActionResult
    {
        [JsonPropertyName("index")]
        public int Index { get; set; }

        [JsonPropertyName("kind")]
        public string Kind { get; set; }

        [JsonPropertyName("action")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string Action { get; set; }

        [JsonPropertyName("outcome")]
        public string Outcome { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; }

        [JsonPropertyName("data")]
        public object Data { get; set; }

        [JsonPropertyName("error")]
        public HopperError Error { get; set; }

        [JsonPropertyName("elapsedMs")]
        public long ElapsedMs { get; set; }

        public static ActionResult Success(string message, object data = null) => new ActionResult
        {
            Outcome = ExecutionOutcomes.Succeeded,
            Message = message,
            Data = data,
            Error = null,
        };

        public static ActionResult Failure(string code, string message, bool retryable = false) => new ActionResult
        {
            Outcome = ExecutionOutcomes.Failed,
            Message = message,
            Data = null,
            Error = new HopperError { Code = code, Message = message, Retryable = retryable },
        };
    }

    internal sealed class TransactionResult
    {
        [JsonPropertyName("outcome")]
        public string Outcome { get; set; }

        [JsonPropertyName("grasshopperUndoRecorded")]
        public bool GrasshopperUndoRecorded { get; set; }

        [JsonPropertyName("rhinoUndoRecorded")]
        public bool RhinoUndoRecorded { get; set; }

        [JsonPropertyName("grasshopperRolledBack")]
        public bool GrasshopperRolledBack { get; set; }

        [JsonPropertyName("rhinoRolledBack")]
        public bool RhinoRolledBack { get; set; }

        [JsonPropertyName("limitations")]
        public List<string> Limitations { get; set; } = new List<string>();

        public static TransactionResult Unchanged() => new TransactionResult
        {
            Outcome = TransactionOutcomes.Unchanged,
        };
    }

    internal sealed class ExecuteActionsData
    {
        [JsonPropertyName("payloadSha256")]
        public string PayloadSha256 { get; set; }

        [JsonPropertyName("actions")]
        public List<ActionResult> Actions { get; set; } = new List<ActionResult>();

        [JsonPropertyName("transaction")]
        public TransactionResult Transaction { get; set; }

        [JsonPropertyName("canvasDigestBefore")]
        public string CanvasDigestBefore { get; set; }

        [JsonPropertyName("canvasDigestAfter")]
        public string CanvasDigestAfter { get; set; }

        [JsonPropertyName("elapsedMs")]
        public long ElapsedMs { get; set; }
    }

    internal sealed class ExecuteActionsResponse
    {
        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("outcome")]
        public string Outcome { get; set; }

        [JsonPropertyName("data")]
        public ExecuteActionsData Data { get; set; }

        [JsonPropertyName("error")]
        public HopperError Error { get; set; }
    }
}
