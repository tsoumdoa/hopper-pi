using System.Text.Json;
using Hopper.Core.Protocol;
using Xunit;

namespace Hopper.Core.Tests;

public class SharedExecutionContractTests
{
    [Theory]
    [InlineData("{\"kind\":\"rhino\",\"lifecycleInstanceId\":\"life\",\"rhinoDocumentId\":\"rhino:1\"}", true)]
    [InlineData("{\"kind\":\"grasshopper\",\"lifecycleInstanceId\":\"life\",\"grasshopperDocumentId\":\"gh:1\",\"associatedRhinoDocumentId\":null}", true)]
    [InlineData("{\"kind\":\"grasshopper\",\"lifecycleInstanceId\":\"life\",\"grasshopperDocumentId\":\"gh:1\",\"associatedRhinoDocumentId\":\"rhino:1\"}", true)]
    [InlineData("{\"kind\":\"grasshopper\",\"lifecycleInstanceId\":\"life\",\"grasshopperDocumentId\":\"gh:1\"}", false)]
    [InlineData("{\"kind\":\"rhino\",\"lifecycleInstanceId\":\"life\",\"rhinoDocumentId\":\"rhino:1\",\"grasshopperDocumentId\":\"gh:1\"}", false)]
    [InlineData("{\"kind\":\"rhino\",\"lifecycleInstanceId\":\"\",\"rhinoDocumentId\":\"rhino:1\"}", false)]
    [InlineData("null", false)]
    [InlineData("[]", false)]
    public void BindingRejectsMissingOrAmbiguousIdentities(string json, bool valid)
    {
        using var document = JsonDocument.Parse(json);
        Assert.Equal(valid, SharedExecutionContract.ParseBinding(document.RootElement) is not null);
    }

    [Fact]
    public void OwnerRequiresGenerationAndCapturedBinding()
    {
        const string binding = "\"binding\":{\"kind\":\"rhino\",\"lifecycleInstanceId\":\"life\",\"rhinoDocumentId\":\"rhino:1\"}";
        using var valid = JsonDocument.Parse("{\"taskId\":\"task\",\"turnId\":\"turn\",\"attachmentGeneration\":\"generation\"," + binding + "}");
        Assert.NotNull(SharedExecutionContract.ParseOwner(valid.RootElement));
        using var missing = JsonDocument.Parse("{\"taskId\":\"task\",\"turnId\":\"turn\"," + binding + "}");
        Assert.Null(SharedExecutionContract.ParseOwner(missing.RootElement));
    }

    [Fact]
    public void EveryOperationHasAnExplicitDisabledPolicy()
    {
        foreach (var operation in Enum.GetValues<RpcOperation>())
        {
            var policy = SharedExecutionContract.Policy(operation);
            Assert.False(policy.SharedDispatchEnabled);
            var expectedJournal = RpcV2Operations.Classify(operation) switch
            {
                RpcOperationClass.Mutation => "wire-mutation",
                RpcOperationClass.Control => "host-only",
                _ => "none",
            };
            Assert.Equal(expectedJournal, policy.DispatchJournal);
        }
        Assert.Throws<ArgumentOutOfRangeException>(() => SharedExecutionContract.Policy((RpcOperation)int.MaxValue));
    }
}
