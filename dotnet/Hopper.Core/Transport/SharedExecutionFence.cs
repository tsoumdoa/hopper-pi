using Hopper.Core.Protocol;
using System.Text.Json;

namespace Hopper.Core.Transport;

/// <summary>Serializes attachment changes with native execution and owns both transaction scopes.</summary>
public sealed class SharedExecutionFence
{
    private readonly object _gate = new();
    private readonly string _lifecycle;
    private readonly Func<RpcRequestV2, ExecutionOwner, string?> _validateBinding;
    private string? _epoch, _client, _generation;
    private readonly Dictionary<string, string> _consumedGrants = new();
    private readonly HashSet<string> _retiredAttachments = new();
    private ExecutionOwner? _rhinoScope, _grasshopperScope;
    private bool _recoveryRequired = true;

    public SharedExecutionFence(string lifecycle, Func<RpcRequestV2, ExecutionOwner, string?> validateBinding)
        => (_lifecycle, _validateBinding) = (lifecycle, validateBinding);

    public string Attach(string epoch, string client)
    {
        lock (_gate)
        {
            if (_epoch == epoch && _client == client) return _generation!;
            if (_retiredAttachments.Contains(epoch + "\0" + client)) throw new InvalidOperationException("The attachment was superseded and cannot reattach.");
            if (_epoch is not null) _retiredAttachments.Add(_epoch + "\0" + _client);
            _epoch = epoch;
            _client = client;
            _generation = Guid.NewGuid().ToString("N");
            // A prior owned-child scope or interrupted host may exist outside our bookkeeping.
            _recoveryRequired = true;
            return _generation;
        }
    }

    public bool Recover(string generation, Func<bool> cleanup) => Recover(generation, (_, _) => cleanup());

    public bool Recover(string generation, Func<ExecutionOwner?, ExecutionOwner?, bool> cleanup)
    {
        ExecutionOwner? rhino, grasshopper;
        lock (_gate)
        {
            if (_generation != generation) return false;
            if (!_recoveryRequired) return true;
            rhino = _rhinoScope; grasshopper = _grasshopperScope;
        }
        if (!cleanup(rhino, grasshopper)) return false;
        lock (_gate)
        {
            if (_generation != generation) return false;
            _rhinoScope = _grasshopperScope = null;
            _recoveryRequired = false;
            return true;
        }
    }

    public OperationResultV2? ValidateAdmission(RpcRequestV2 request, string client)
    {
        lock (_gate) return Validate(request, client, documents: false);
    }

    public OperationResultV2 Execute(RpcRequestV2 request, string client, Func<OperationResultV2> execute)
    {
        ExecutionOwner? owner;
        lock (_gate)
        {
            var invalid = Validate(request, client, documents: true);
            if (invalid is not null) return invalid;
            if (request.DocumentActionOwner is { } actionJson)
            {
                var action = SharedExecutionContract.ParseDocumentActionOwner(actionJson)!;
                _consumedGrants[action.GrantId] = request.OperationId!;
            }
            owner = request.ExecutionOwner is { } json ? SharedExecutionContract.ParseOwner(json) : null;
            // Reserve before invoking native begin; even a thrown/partial begin must retain ownership.
            if (owner is not null && request.Operation == RpcOperation.beginRhinoAgentTransaction) _rhinoScope = owner;
            if (owner is not null && request.Operation == RpcOperation.beginAgentTransaction) _grasshopperScope = owner;
        }
        // Running native work cannot be stopped by reattachment. Keep the transport responsive;
        // the ordered UI queue places recovery after this work and before any fresh execution.
        var result = execute();
        lock (_gate)
        {
            var succeeded = result.Class == RpcResultClass.completed &&
                !(result.Data is { ValueKind: System.Text.Json.JsonValueKind.Object } data &&
                  data.TryGetProperty("ok", out var ok) && ok.ValueKind == System.Text.Json.JsonValueKind.False);
            if (owner is not null && succeeded && owner.AttachmentGeneration == _generation)
            {
                if (request.Operation == RpcOperation.beginRhinoAgentTransaction) _rhinoScope = owner;
                if (request.Operation == RpcOperation.beginAgentTransaction) _grasshopperScope = owner;
                if (request.Operation is RpcOperation.commitRhinoAgentTransaction or RpcOperation.cancelRhinoAgentTransaction) _rhinoScope = null;
                if (request.Operation is RpcOperation.commitAgentTransaction or RpcOperation.cancelAgentTransaction) _grasshopperScope = null;
            }
            if (owner is not null && owner.AttachmentGeneration == _generation &&
                result.Data is { ValueKind: System.Text.Json.JsonValueKind.Object } boundary &&
                boundary.TryGetProperty("transaction", out var transaction) && transaction.TryGetProperty("state", out var state) && state.GetString() == "idle")
            {
                if (request.Operation == RpcOperation.manageRhinoDocument && _rhinoScope == owner) _rhinoScope = null;
                if (request.Operation == RpcOperation.manageGrasshopperDocument && _grasshopperScope == owner) _grasshopperScope = null;
            }
            return WithScopeState(request, result);
        }
    }

    // Read under _gate, after ownership transitions. Segment state alone cannot
    // distinguish an idle document from a reserved, failed transaction begin.
    private OperationResultV2 WithScopeState(RpcRequestV2 request, OperationResultV2 result)
    {
        if (result.Data is not { ValueKind: JsonValueKind.Object } data) return result;
        var query = request.Operation == RpcOperation.getDocumentTransactionState;
        if (!query && (!data.TryGetProperty("transaction", out var transaction) || transaction.ValueKind != JsonValueKind.Object)) return result;
        var kind = query ? request.Args.GetProperty("owner").GetString()
            : request.Operation is RpcOperation.beginRhinoAgentTransaction or RpcOperation.commitRhinoAgentTransaction
                or RpcOperation.cancelRhinoAgentTransaction or RpcOperation.manageRhinoDocument or RpcOperation.runRhinoScript ? "rhino"
                : SharedExecutionContract.Policy(request.Operation).Binding == "rhino" ? "rhino" : "grasshopper";
        var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(data.GetRawText())!;
        var segment = query ? fields : JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(fields["transaction"].GetRawText())!;
        var scope = kind == "rhino" ? _rhinoScope : _grasshopperScope;
        object? binding = scope?.Binding switch {
            RhinoTargetBinding rhino => new { kind = "rhino", rhino.LifecycleInstanceId, rhino.RhinoDocumentId },
            GrasshopperTargetBinding gh => new { kind = "grasshopper", gh.LifecycleInstanceId, gh.GrasshopperDocumentId, gh.AssociatedRhinoDocumentId },
            _ => null
        };
        segment["scopeOwner"] = JsonSerializer.SerializeToElement(scope is null ? null
            : new { scope.TaskId, scope.TurnId, scope.AttachmentGeneration, binding }, RpcV2Contract.JsonOptions);
        segment["recoveryRequired"] = JsonSerializer.SerializeToElement(_recoveryRequired);
        if (!query) fields["transaction"] = JsonSerializer.SerializeToElement(segment);
        return result with { Data = JsonSerializer.SerializeToElement(fields) };
    }

    private OperationResultV2? Validate(RpcRequestV2 request, string client, bool documents)
    {
        if (_client != client || _generation is null) return Failure("ATTACHMENT_STALE: Authenticate the current host attachment first.");
        var policy = SharedExecutionContract.Policy(request.Operation);
        if (policy.Binding == "lifecycle" || request.Operation == RpcOperation.getDocumentTransactionState && request.ExecutionOwner is null) return null;
        var boundDocumentAction = policy.Binding == "document-action" && request.ExecutionOwner is not null;
        if (policy.Binding == "document-action" && !boundDocumentAction)
        {
            var action = request.DocumentActionOwner is { } actionJson ? SharedExecutionContract.ParseDocumentActionOwner(actionJson) : null;
            if (action is null || action.LifecycleInstanceId != _lifecycle || action.AttachmentGeneration != _generation)
                return Failure("DOCUMENT_ACTION_REQUIRED: Managed document transitions require host execution ownership.");
            if (!request.Args.TryGetProperty("expectedDestinations", out var destinations) || destinations.ValueKind != System.Text.Json.JsonValueKind.Array)
                return Failure("DESTINATION_BASELINES_REQUIRED: Shared managed actions require explicit reserved write destinations.");
            if (_recoveryRequired || _rhinoScope is not null || _grasshopperScope is not null)
                return Failure("DOCUMENT_HANDOFF_REQUIRED: Close both native scopes and confirm recovery before changing documents.");
            if (request.OperationId is null || _consumedGrants.TryGetValue(action.GrantId, out var used) && used != request.OperationId)
                return Failure("DOCUMENT_GRANT_CONSUMED: This grant already dispatched a document action.");
            return null;
        }
        if (request.DocumentActionOwner is not null) return Failure("DOCUMENT_GRANT_SCOPE: A document action owner cannot execute geometry.");
        var owner = request.ExecutionOwner is { } json ? SharedExecutionContract.ParseOwner(json) : null;
        if (owner is null || owner.Binding.LifecycleInstanceId != _lifecycle || owner.AttachmentGeneration != _generation)
            return Failure("EXECUTION_OWNER_STALE: The captured lifecycle or attachment generation changed.");
        if (_recoveryRequired) return Failure("RECOVERY_REQUIRED: Native transaction cleanup has not completed.");
        if (boundDocumentAction)
        {
            if (!request.Args.TryGetProperty("action", out var action) || action.GetString() is not ("save" or "saveAs" or "close" or "activate"))
                return Failure("DOCUMENT_ACTION_REQUIRED: New and open must run through the shared document action service.");
            if (!request.Args.TryGetProperty("expectedDestinations", out var destinations) || destinations.ValueKind != System.Text.Json.JsonValueKind.Array)
                return Failure("DESTINATION_BASELINES_REQUIRED: Bound document writes require reserved destination baselines.");
            if (request.Operation == RpcOperation.manageGrasshopperDocument && owner.Binding is not GrasshopperTargetBinding ||
                request.Operation == RpcOperation.manageRhinoDocument && owner.Binding is GrasshopperTargetBinding { AssociatedRhinoDocumentId: null })
                return Failure("TARGET_KIND_MISMATCH: Document action conflicts with the captured binding.");
            if (action.GetString() == "activate" && (_rhinoScope is not null || _grasshopperScope is not null ||
                !request.Args.TryGetProperty("expectedStateToken", out var token) || token.ValueKind != System.Text.Json.JsonValueKind.String))
                return Failure("DOCUMENT_HANDOFF_REQUIRED: Captured activation requires idle scopes and an observed target state token.");
            if (request.Operation == RpcOperation.manageRhinoDocument && _grasshopperScope is not null || request.Operation == RpcOperation.manageGrasshopperDocument && _rhinoScope is not null)
                return Failure("DOCUMENT_HANDOFF_REQUIRED: Close the other native scope before a bound document boundary.");
        }
        if ((_rhinoScope is not null && _rhinoScope != owner) || (_grasshopperScope is not null && _grasshopperScope != owner))
            return Failure("TRANSACTION_OWNER_MISMATCH: Another task or turn owns an open native scope.");
        if (policy.Binding == "rhino" && owner.Binding is not RhinoTargetBinding && owner.Binding is not GrasshopperTargetBinding { AssociatedRhinoDocumentId: not null } ||
            policy.Binding is "grasshopper" or "associated-pair" && owner.Binding is not GrasshopperTargetBinding)
            return Failure("TARGET_KIND_MISMATCH: Operation does not match the captured document kind.");
        if (policy.Binding == "associated-pair" && owner.Binding is GrasshopperTargetBinding { AssociatedRhinoDocumentId: null })
            return Failure("RHINO_ASSOCIATION_REQUIRED: This operation requires a captured Rhino document.");
        if (request.Operation is RpcOperation.commitRhinoAgentTransaction or RpcOperation.cancelRhinoAgentTransaction && _rhinoScope != owner ||
            request.Operation is RpcOperation.commitAgentTransaction or RpcOperation.cancelAgentTransaction && _grasshopperScope != owner)
            return Failure("TRANSACTION_OWNER_MISMATCH: This turn did not open the native scope.");
        if (request.Operation == RpcOperation.importRhinoArtifact && _rhinoScope != owner) return Failure("TRANSACTION_REQUIRED: Artifact import needs this turn to own a Rhino scope.");
        if (documents && _validateBinding(request, owner) is { } error) return Failure(error);
        return null;
    }

    private static OperationResultV2 Failure(string message) => new()
        { Class = RpcResultClass.failed, ReasonCode = RpcReasonCode.OPERATION_FAILED, Message = message };
}
