using System.Text.Json;
using Hopper.Core.Protocol;
using Hopper.Core.Operations;
using Hopper.Core.Transport;
using Xunit;

namespace Hopper.Core.Tests;

[Collection("NetMQ transport")]
public class SharedExecutionFenceTests
{
    private static RpcRequestV2 Request(string generation, string task = "task", RpcOperation operation = RpcOperation.queryRhinoObjects) => new()
    {
        Operation = operation, Args = JsonSerializer.SerializeToElement(new { }),
        ExecutionOwner = JsonSerializer.SerializeToElement(new { taskId = task, turnId = "turn", attachmentGeneration = generation,
            binding = new { kind = "rhino", lifecycleInstanceId = "life", rhinoDocumentId = "doc" } })
    };
    private static OperationResultV2 Completed() => new() { Class = RpcResultClass.completed, ReasonCode = RpcReasonCode.OK };
    private static SharedExecutionFence Fence() => new("life", (_, _) => null);

    [Fact]
    public void NativeContextValidationRejectsFocusAssociationAndArgumentDriftButPermitsOwnedCleanup()
    {
        var previousRhino = DocumentSession.ActiveRhinoDocumentId;
        var previousGrasshopper = DocumentSession.ActiveGrasshopperDocumentId;
        var previousAssociation = DocumentSession.AssociatedRhinoDocumentId;
        try
        {
            var lifecycle = DocumentSession.LifecycleInstanceId;
            var activeRhino = "rhino-a"; var activeCanvas = "gh-a"; string? association = "rhino-a";
            DocumentSession.ActiveRhinoDocumentId = () => activeRhino;
            DocumentSession.ActiveGrasshopperDocumentId = () => activeCanvas;
            DocumentSession.AssociatedRhinoDocumentId = () => association;
            var owner = new ExecutionOwner("task", "turn", new GrasshopperTargetBinding(lifecycle, "gh-a", "rhino-a"), "gen");
            var request = new RpcRequestV2 { Operation = RpcOperation.setSliderValue, Args = JsonSerializer.SerializeToElement(new { }) };
            Assert.Null(DocumentSession.ValidateSharedBinding(request, owner));
            activeRhino = "rhino-b";
            Assert.Contains("TARGET_CHANGED", DocumentSession.ValidateSharedBinding(request, owner));
            Assert.Null(DocumentSession.ValidateSharedBinding(request with { Operation = RpcOperation.cancelAgentTransaction }, owner));
            activeRhino = "rhino-a"; association = "rhino-b";
            Assert.Contains("ASSOCIATION_CHANGED", DocumentSession.ValidateSharedBinding(request, owner));
            association = "rhino-a"; activeCanvas = "gh-b";
            Assert.Contains("TARGET_CHANGED", DocumentSession.ValidateSharedBinding(request, owner));
            activeCanvas = "gh-a";
            Assert.Contains("TARGET_OVERRIDE", DocumentSession.ValidateSharedBinding(request with { Args = JsonSerializer.SerializeToElement(new { documentId = "other" }) }, owner));
        }
        finally
        {
            DocumentSession.ActiveRhinoDocumentId = previousRhino; DocumentSession.ActiveGrasshopperDocumentId = previousGrasshopper;
            DocumentSession.AssociatedRhinoDocumentId = previousAssociation;
        }
    }

    [Fact]
    public void RecoveryReceivesOriginalScopeOwnerAndFailedMetadataCheckKeepsFenceClosed()
    {
        var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        fence.Execute(Request(generation, operation: RpcOperation.beginRhinoAgentTransaction), "client", Completed);
        var replacement = fence.Attach("next", "replacement");
        Assert.False(fence.Recover(replacement, (rhino, grasshopper) =>
        {
            Assert.Equal("task", rhino!.TaskId); Assert.Equal(generation, rhino.AttachmentGeneration); Assert.Null(grasshopper);
            return false;
        }));
        Assert.Contains("RECOVERY_REQUIRED", fence.Execute(Request(replacement), "replacement", Completed).Message);
    }

    [Fact]
    public void DocumentActionWorksWithoutDocumentButCannotReuseGrantOrOverlapScope()
    {
        var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        var action = new RpcRequestV2 { Operation = RpcOperation.manageRhinoDocument, OperationId = "operation", Args = JsonSerializer.SerializeToElement(new { action = "new", expectedDestinations = Array.Empty<object>() }),
            DocumentActionOwner = JsonSerializer.SerializeToElement(new { taskId = "task", turnId = "turn", actionId = "action", grantId = "grant", lifecycleInstanceId = "life", attachmentGeneration = generation }) };
        fence.Execute(Request(generation, operation: RpcOperation.beginRhinoAgentTransaction), "client", Completed);
        Assert.Contains("DOCUMENT_HANDOFF_REQUIRED", fence.Execute(action, "client", Completed).Message);
        fence.Execute(Request(generation, operation: RpcOperation.commitRhinoAgentTransaction), "client", Completed);
        Assert.Equal(RpcResultClass.completed, fence.Execute(action, "client", Completed).Class);
        Assert.Contains("DOCUMENT_GRANT_CONSUMED", fence.Execute(action with { OperationId = "duplicate-new" }, "client", () => throw new Exception("grant replay")).Message);
        Assert.Contains("DOCUMENT_GRANT_SCOPE", fence.Execute(action with { Operation = RpcOperation.runRhinoScript }, "client", Completed).Message);
    }

    [Fact]
    public void BoundDocumentActionsRejectNewAndClearOnlyTheirRecordedIdleScope()
    {
        var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        var request = Request(generation, operation: RpcOperation.manageRhinoDocument) with {
            Args = JsonSerializer.SerializeToElement(new { action = "save", documentId = "doc", expectedDestinations = Array.Empty<object>() }) };
        fence.Execute(Request(generation, operation: RpcOperation.beginRhinoAgentTransaction), "client", Completed);
        Assert.Contains("DOCUMENT_GRANT_REQUIRED", fence.Execute(request with { Args = JsonSerializer.SerializeToElement(new { action = "new" }) }, "client", Completed).Message);
        Assert.Contains("TRANSACTION_OWNER_MISMATCH", fence.Execute(request with { ExecutionOwner = Request(generation, "other").ExecutionOwner }, "client", Completed).Message);
        Assert.Equal(RpcResultClass.completed, fence.Execute(request, "client", () => new() { Class = RpcResultClass.completed, ReasonCode = RpcReasonCode.OK,
            Data = JsonSerializer.SerializeToElement(new { ok = false, transaction = new { state = "idle" } }) }).Class);
        Assert.Equal(RpcResultClass.completed, fence.Execute(Request(generation, "other"), "client", Completed).Class);
    }

    [Fact]
    public void CapturedActivationMaySelectInactiveRhinoButCannotOverrideTargetOrOpenScopes()
    {
        var previous = DocumentSession.ActiveRhinoDocumentId;
        try
        {
            DocumentSession.ActiveRhinoDocumentId = () => "other";
            var owner = new ExecutionOwner("task", "turn", new RhinoTargetBinding(DocumentSession.LifecycleInstanceId, "doc"), "generation");
            var request = new RpcRequestV2 { Operation = RpcOperation.manageRhinoDocument, Args = JsonSerializer.SerializeToElement(new {
                action = "activate", documentId = "doc", expectedStateToken = "token", expectedActiveDocument = "other", expectedDestinations = Array.Empty<object>() }) };
            Assert.Null(DocumentSession.ValidateSharedBinding(request, owner));
            Assert.Contains("TARGET_CHANGED", DocumentSession.ValidateSharedBinding(request with { Operation = RpcOperation.queryRhinoObjects }, owner));
            Assert.Contains("TARGET_OVERRIDE", DocumentSession.ValidateSharedBinding(request with { Args = JsonSerializer.SerializeToElement(new { action = "activate", documentId = "unowned" }) }, owner));
            var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
            request = request with { ExecutionOwner = Request(generation).ExecutionOwner };
            Assert.Equal(RpcResultClass.completed, fence.Execute(request, "client", Completed).Class);
            fence.Execute(Request(generation, operation: RpcOperation.beginRhinoAgentTransaction), "client", Completed);
            Assert.Contains("DOCUMENT_HANDOFF_REQUIRED", fence.Execute(request, "client", Completed).Message);
        }
        finally { DocumentSession.ActiveRhinoDocumentId = previous; }
    }

    [Fact]
    public void ReattachmentRejectsOldQueuedWorkAndRequiresCleanup()
    {
        var fence = Fence();
        var first = fence.Attach("epoch1", "client1");
        Assert.Equal(first, fence.Attach("epoch1", "client1"));
        Assert.Contains("RECOVERY_REQUIRED", fence.Execute(Request(first), "client1", Completed).Message);
        Assert.True(fence.Recover(first, () => true));
        var second = fence.Attach("epoch2", "client2");
        Assert.NotEqual(first, second);
        Assert.False(fence.Recover(first, () => throw new Exception("stale cleanup must not execute")));
        Assert.NotEqual(RpcResultClass.completed, fence.Execute(Request(first), "client1", () => throw new Exception("stale work executed")).Class);
        Assert.Throws<InvalidOperationException>(() => fence.Attach("epoch1", "client1"));
        Assert.False(fence.Recover(second, () => false));
        Assert.Contains("RECOVERY_REQUIRED", fence.Execute(Request(second), "client2", Completed).Message);
        Assert.True(fence.Recover(second, () => true));
        Assert.Equal(RpcResultClass.completed, fence.Execute(Request(second), "client2", Completed).Class);
    }

    [Fact]
    public void DifferentTaskCannotEditOrCloseOwnersScope()
    {
        var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        fence.Execute(Request(generation, operation: RpcOperation.beginRhinoAgentTransaction), "client", Completed);
        foreach (var op in new[] { RpcOperation.queryRhinoObjects, RpcOperation.beginRhinoAgentTransaction, RpcOperation.commitRhinoAgentTransaction, RpcOperation.cancelRhinoAgentTransaction })
            Assert.Contains("TRANSACTION_OWNER_MISMATCH", fence.Execute(Request(generation, "other", op), "client", () => throw new Exception("wrong owner executed")).Message);
        fence.Execute(Request(generation, operation: RpcOperation.commitRhinoAgentTransaction), "client", Completed);
        Assert.Equal(RpcResultClass.completed, fence.Execute(Request(generation, "other"), "client", Completed).Class);
    }

    [Fact]
    public void QueueHeadRevalidatesNativeDocumentAfterAdmission()
    {
        var active = "doc";
        var fence = new SharedExecutionFence("life", (_, _) => active == "doc" ? null : "TARGET_CHANGED");
        var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        Assert.Null(fence.ValidateAdmission(Request(generation), "client"));
        active = "other";
        Assert.Equal("TARGET_CHANGED", fence.Execute(Request(generation), "client", () => throw new Exception("wrong document executed")).Message);
    }

    [Fact]
    public async Task RunningOperationDoesNotBlockReattachmentButFreshWorkRequiresRecovery()
    {
        var fence = Fence(); var generation = fence.Attach("epoch", "client"); fence.Recover(generation, () => true);
        using var entered = new ManualResetEventSlim(); using var finish = new ManualResetEventSlim();
        var running = Task.Run(() => fence.Execute(Request(generation), "client", () => { entered.Set(); Assert.True(finish.Wait(TimeSpan.FromSeconds(3))); return Completed(); }));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(3)));
        try
        {
            var next = fence.Attach("next", "replacement");
            Assert.Contains("RECOVERY_REQUIRED", fence.ValidateAdmission(Request(next), "replacement")!.Message);
        }
        finally { finish.Set(); }
        Assert.Equal(RpcResultClass.completed, (await running).Class);
    }
}
