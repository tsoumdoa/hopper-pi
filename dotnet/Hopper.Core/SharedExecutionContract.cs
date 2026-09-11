using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hopper.Core.Protocol;

public abstract record TargetBinding(string LifecycleInstanceId);
public sealed record RhinoTargetBinding(string LifecycleInstanceId, string RhinoDocumentId) : TargetBinding(LifecycleInstanceId);
public sealed record GrasshopperTargetBinding(string LifecycleInstanceId, string GrasshopperDocumentId, string? AssociatedRhinoDocumentId) : TargetBinding(LifecycleInstanceId);
public sealed record DocumentActionOwner(string TaskId, string TurnId, string ActionId, string GrantId, string LifecycleInstanceId, string AttachmentGeneration);
public sealed record ExecutionOwner(string TaskId, string TurnId, TargetBinding Binding, string AttachmentGeneration);
public sealed record SharedOperationPolicy(string Binding, string DispatchJournal, string Recovery)
{
    public bool SharedDispatchEnabled => true;
}

// Shared transports enforce this policy with attachment fencing and native context validation.
public static class SharedExecutionContract
{
    private static bool Identifier(JsonElement value) => value.ValueKind == JsonValueKind.String &&
        Regex.IsMatch(value.GetString()!, @"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z");
    private static bool Exact(JsonElement value, params string[] keys) => value.ValueKind == JsonValueKind.Object &&
        value.EnumerateObject().Count() == keys.Length && keys.All(key => value.TryGetProperty(key, out _));

    public static TargetBinding? ParseBinding(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("lifecycleInstanceId", out var lifecycle) || !Identifier(lifecycle)
            || !input.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String) return null;
        if (kind.GetString() == "rhino" && Exact(input, "lifecycleInstanceId", "kind", "rhinoDocumentId") && Identifier(input.GetProperty("rhinoDocumentId")))
            return new RhinoTargetBinding(lifecycle.GetString()!, input.GetProperty("rhinoDocumentId").GetString()!);
        if (kind.GetString() == "grasshopper" && Exact(input, "lifecycleInstanceId", "kind", "grasshopperDocumentId", "associatedRhinoDocumentId")
            && Identifier(input.GetProperty("grasshopperDocumentId")))
        {
            var association = input.GetProperty("associatedRhinoDocumentId");
            if (association.ValueKind == JsonValueKind.Null || Identifier(association))
                return new GrasshopperTargetBinding(lifecycle.GetString()!, input.GetProperty("grasshopperDocumentId").GetString()!, association.GetString());
        }
        return null;
    }

    public static ExecutionOwner? ParseOwner(JsonElement input)
    {
        if (!Exact(input, "taskId", "turnId", "binding", "attachmentGeneration") || !Identifier(input.GetProperty("taskId"))
            || !Identifier(input.GetProperty("turnId")) || !Identifier(input.GetProperty("attachmentGeneration"))) return null;
        var binding = ParseBinding(input.GetProperty("binding"));
        return binding is null ? null : new ExecutionOwner(input.GetProperty("taskId").GetString()!, input.GetProperty("turnId").GetString()!, binding, input.GetProperty("attachmentGeneration").GetString()!);
    }

    public static DocumentActionOwner? ParseDocumentActionOwner(JsonElement input)
    {
        var keys = new[] { "taskId", "turnId", "actionId", "grantId", "lifecycleInstanceId", "attachmentGeneration" };
        if (!Exact(input, keys) || keys.Any(key => !Identifier(input.GetProperty(key)))) return null;
        return new(input.GetProperty("taskId").GetString()!, input.GetProperty("turnId").GetString()!, input.GetProperty("actionId").GetString()!,
            input.GetProperty("grantId").GetString()!, input.GetProperty("lifecycleInstanceId").GetString()!, input.GetProperty("attachmentGeneration").GetString()!);
    }

    public static SharedOperationPolicy Policy(RpcOperation operation) => operation switch
    {
        RpcOperation.listRhinoDocuments => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.getRhinoDocument => new("rhino", "none", "revalidate-read"),
        RpcOperation.getRhinoDocumentSettings => new("rhino", "none", "revalidate-read"),
        RpcOperation.listGrasshopperDocuments => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.getGrasshopperDocument => new("grasshopper", "none", "revalidate-read"),
        RpcOperation.getGrasshopperDocumentSettings => new("associated-pair", "none", "revalidate-read"),
        RpcOperation.browseDocumentFiles => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.getDocumentTransactionState => new("either-document", "none", "revalidate-read"),
        RpcOperation.getRuntimeStatus => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.getOperationResult => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.listAllComponents => new("lifecycle", "none", "revalidate-read"),
        RpcOperation.getCurrentCanvas => new("grasshopper", "none", "revalidate-read"),
        RpcOperation.getCanvasErrors => new("grasshopper", "none", "revalidate-read"),
        RpcOperation.listScriptParams => new("grasshopper", "none", "revalidate-read"),
        RpcOperation.getScriptCode => new("grasshopper", "none", "revalidate-read"),
        RpcOperation.queryRhinoObjects => new("rhino", "none", "revalidate-read"),
        RpcOperation.captureRhinoView => new("rhino", "none", "revalidate-read"),
        RpcOperation.getParamRhinoGeometry => new("associated-pair", "none", "revalidate-read"),
        RpcOperation.lifecycleHandshake => new("lifecycle", "host-only", "authenticated-attachment"),
        RpcOperation.startGrasshopper => new("lifecycle", "host-only", "runtime-postcondition"),
        RpcOperation.cancelOperation => new("lifecycle", "host-only", "cancelled-mutation-result"),
        RpcOperation.exportRhinoArtifact => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.importRhinoArtifact => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.manageRhinoDocument => new("document-action", "wire-mutation", "retained-mutation-result"),
        RpcOperation.manageGrasshopperDocument => new("document-action", "wire-mutation", "retained-mutation-result"),
        RpcOperation.applyGraph => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.runRhinoScript => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.controlRhinoView => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.addComponent => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.deleteComponent => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.connectWire => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.disconnectWire => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.moveComponent => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.renameComponent => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setComponentLocked => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setComponentHidden => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.addGroup => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.removeFromGroup => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.deleteGroup => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.changeGroupColor => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.renameGroup => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.changeGroupStyle => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createSlider => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.editSliderRange => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setSliderValue => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createPanel => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setPanelParams => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setPanelText => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createToggle => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setToggleValue => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createSwatch => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setSwatchColor => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createScribble => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setScribbleText => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createValueList => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setValueListSelected => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.createScriptNode => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setScriptCode => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.syncScriptParams => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.addScriptInput => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.removeScriptInput => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.addScriptOutput => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.removeScriptOutput => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.editParamProps => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.beginAgentTransaction => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.commitAgentTransaction => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.cancelAgentTransaction => new("grasshopper", "wire-mutation", "retained-mutation-result"),
        RpcOperation.beginRhinoAgentTransaction => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.commitRhinoAgentTransaction => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.cancelRhinoAgentTransaction => new("rhino", "wire-mutation", "retained-mutation-result"),
        RpcOperation.setParamRhinoGeometry => new("associated-pair", "wire-mutation", "retained-mutation-result"),
        _ => throw new ArgumentOutOfRangeException(nameof(operation), operation, "Operation has no shared execution policy"),
    };
}
