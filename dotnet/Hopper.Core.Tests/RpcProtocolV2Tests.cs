using System.Text.Json;
using Hopper.Core.Protocol;
using Xunit;

namespace Hopper.Core.Tests;

public class RpcProtocolV2Tests
{
    [Fact]
    public void SharedRequestFixturesMatchCSharpContract()
    {
        using var fixtures = ReadContractJson("fixtures.json");

        foreach (var fixture in fixtures.RootElement.GetProperty("validRequests").EnumerateArray())
        {
            var result = RpcV2Contract.ParseRequest(fixture.GetProperty("value").GetRawText());
            Assert.True(result.IsValid, Failure(fixture, result.Errors));
            Assert.NotNull(result.Value);
            Assert.True(RpcV2Contract.ParseRequest(RpcV2Contract.SerializeRequest(result.Value)).IsValid);
        }

        foreach (var fixture in fixtures.RootElement.GetProperty("invalidRequests").EnumerateArray())
        {
            var result = RpcV2Contract.ParseRequest(fixture.GetProperty("value").GetRawText());
            Assert.False(result.IsValid, fixture.GetProperty("name").GetString());
            Assert.Null(result.Value);
        }
    }

    [Fact]
    public void SharedResponseFixturesMatchCSharpContract()
    {
        using var fixtures = ReadContractJson("fixtures.json");

        foreach (var fixture in fixtures.RootElement.GetProperty("validResponses").EnumerateArray())
        {
            var result = RpcV2Contract.ParseResponse(fixture.GetProperty("value").GetRawText());
            Assert.True(result.IsValid, Failure(fixture, result.Errors));
            Assert.NotNull(result.Value);
            Assert.True(RpcV2Contract.ParseResponse(RpcV2Contract.SerializeResponse(result.Value)).IsValid);
        }

        foreach (var fixture in fixtures.RootElement.GetProperty("invalidResponses").EnumerateArray())
        {
            var result = RpcV2Contract.ParseResponse(fixture.GetProperty("value").GetRawText());
            Assert.False(result.IsValid, fixture.GetProperty("name").GetString());
            Assert.Null(result.Value);
        }
    }

    [Fact]
    public void SharedMetadataMatchesCSharpConstants()
    {
        using var metadata = ReadContractJson("metadata.json");
        var root = metadata.RootElement;

        Assert.Equal(RpcV2Contract.ProtocolVersion, root.GetProperty("protocolVersion").GetInt32());
        Assert.Equal(RpcV2Contract.UncorrelatedRequestPolicy, root.GetProperty("uncorrelatedRequestPolicy").GetString());

        var classifications = root.GetProperty("operationClassification");
        AssertNames(RpcV2Operations.Query, classifications.GetProperty("query"));
        AssertNames(RpcV2Operations.Control, classifications.GetProperty("control"));
        AssertNames(RpcV2Operations.Mutation, classifications.GetProperty("mutation"));

        var classified = RpcV2Operations.Query.Concat(RpcV2Operations.Control).Concat(RpcV2Operations.Mutation).ToArray();
        Assert.Equal(Enum.GetValues<RpcOperation>().Length, classified.Length);
        Assert.Equal(classified.Length, classified.Distinct().Count());
        Assert.All(RpcV2Operations.Query, operation => Assert.Equal(RpcOperationClass.Query, RpcV2Operations.Classify(operation)));
        Assert.All(RpcV2Operations.Control, operation => Assert.Equal(RpcOperationClass.Control, RpcV2Operations.Classify(operation)));
        Assert.All(RpcV2Operations.Mutation, operation => Assert.Equal(RpcOperationClass.Mutation, RpcV2Operations.Classify(operation)));

        AssertNames(Enum.GetValues<RpcResultClass>(), root.GetProperty("rhinoResultClasses"));
        AssertNames(Enum.GetValues<NodeLocalResultClass>(), root.GetProperty("nodeLocalResultClasses"));
        AssertNames(Enum.GetValues<RpcReasonCode>(), root.GetProperty("reasonCodes"));
        AssertNames(RpcV2Contract.ProtocolErrorReasonCodes, root.GetProperty("protocolErrorReasonCodes"));

        var framing = root.GetProperty("framing");
        Assert.Equal(RouterDealerFramingV2.Transport, framing.GetProperty("transport").GetString());
        Assert.Equal(RouterDealerFramingV2.PayloadEncoding, framing.GetProperty("payloadEncoding").GetString());
        Assert.Equal(RouterDealerFramingV2.DelimiterFrame, framing.GetProperty("delimiterFrame").GetBoolean());
        AssertStrings(RouterDealerFramingV2.DealerSends, framing.GetProperty("dealerToRouter").GetProperty("dealerSends"));
        AssertStrings(RouterDealerFramingV2.RouterReceives, framing.GetProperty("dealerToRouter").GetProperty("routerReceives"));
        AssertStrings(RouterDealerFramingV2.RouterSends, framing.GetProperty("routerToDealer").GetProperty("routerSends"));
        AssertStrings(RouterDealerFramingV2.DealerReceives, framing.GetProperty("routerToDealer").GetProperty("dealerReceives"));
        var identity = framing.GetProperty("routingIdentity");
        Assert.Equal(RouterDealerFramingV2.RoutingIdentityEncoding, identity.GetProperty("encoding").GetString());
        Assert.Equal(RouterDealerFramingV2.RoutingIdentityLifetime, identity.GetProperty("lifetime").GetString());
        Assert.Equal(RouterDealerFramingV2.RoutingIdentityIncludedInJson, identity.GetProperty("includedInJson").GetBoolean());
    }

    [Fact]
    public void InternalFixturesDeserializeIntoRhinoFreeDtos()
    {
        using var fixtures = ReadContractJson("fixtures.json");
        var requests = fixtures.RootElement.GetProperty("validRequests").EnumerateArray().ToArray();
        var responses = fixtures.RootElement.GetProperty("validResponses").EnumerateArray().ToArray();

        var handshake = ParseRequest(requests, RpcOperation.lifecycleHandshake);
        Assert.Equal(4242, handshake.Args.Deserialize<LifecycleHandshakeArgsV2>(RpcV2Contract.JsonOptions)?.NodeProcessId);
        var lookup = ParseRequest(requests, RpcOperation.getOperationResult);
        Assert.Equal("op-set-slider-1", lookup.Args.Deserialize<OperationReferenceArgsV2>(RpcV2Contract.JsonOptions)?.OperationId);

        var runtimeResponse = ParseResponse(responses, RpcOperation.getRuntimeStatus);
        var runtimeStatus = runtimeResponse.Result.Data?.Deserialize<RuntimeStatusV2>(RpcV2Contract.JsonOptions);
        Assert.Equal(RpcV2Contract.ProtocolVersion, runtimeStatus?.ProtocolVersion);
        Assert.NotNull(runtimeStatus?.Dispatcher);

        var handshakeResponse = ParseResponse(responses, RpcOperation.lifecycleHandshake);
        Assert.Equal(HandshakeState.live,
            handshakeResponse.Result.Data?.Deserialize<LifecycleHandshakeDataV2>(RpcV2Contract.JsonOptions)?.Handshake);
        var startResponse = ParseResponse(responses, RpcOperation.startGrasshopper);
        Assert.Equal(StartGrasshopperState.start_requested,
            startResponse.Result.Data?.Deserialize<StartGrasshopperDataV2>(RpcV2Contract.JsonOptions)?.State);
        var lookupResponse = ParseResponse(responses, RpcOperation.getOperationResult);
        Assert.Equal(OperationLookupState.pending,
            lookupResponse.Result.Data?.Deserialize<OperationLookupDataV2>(RpcV2Contract.JsonOptions)?.State);
        var cancelResponse = ParseResponse(responses, RpcOperation.cancelOperation);
        Assert.Equal(CancelOperationState.rejected_already_started,
            cancelResponse.Result.Data?.Deserialize<CancelOperationDataV2>(RpcV2Contract.JsonOptions)?.State);

        var protocolErrorJson = responses.First(item => item.GetProperty("value").TryGetProperty("errorType", out _))
            .GetProperty("value").GetRawText();
        Assert.IsType<ProtocolErrorResponseV2>(RpcV2Contract.ParseResponse(protocolErrorJson).Value);

        var outputAssemblies = Directory.EnumerateFiles(AppContext.BaseDirectory, "*.dll")
            .Select(Path.GetFileName)
            .Where(name => name is not null)
            .ToArray();
        Assert.DoesNotContain("RhinoCommon.dll", outputAssemblies, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("Grasshopper.dll", outputAssemblies, StringComparer.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(RpcResultClass.completed, RpcReasonCode.OK, true)]
    [InlineData(RpcResultClass.completed, RpcReasonCode.INTERNAL_ERROR, false)]
    [InlineData(RpcResultClass.busy, RpcReasonCode.DISPATCHER_BUSY, true)]
    [InlineData(RpcResultClass.failed, RpcReasonCode.UNKNOWN_OPERATION, true)]
    public void ResultClassesConstrainReasonCodes(RpcResultClass resultClass, RpcReasonCode reason, bool expected)
    {
        Assert.Equal(expected, RpcV2Contract.IsReasonAllowed(resultClass, reason));
    }

    private static RpcRequestV2 ParseRequest(IEnumerable<JsonElement> fixtures, RpcOperation operation)
    {
        var json = fixtures.Single(item => item.GetProperty("value").GetProperty("operation").GetString() == operation.ToString())
            .GetProperty("value").GetRawText();
        return Assert.IsType<RpcRequestV2>(RpcV2Contract.ParseRequest(json).Value);
    }

    private static OperationResponseV2 ParseResponse(IEnumerable<JsonElement> fixtures, RpcOperation operation)
    {
        var json = fixtures.First(item => item.GetProperty("value").TryGetProperty("operation", out var value)
                && value.GetString() == operation.ToString()
                && !item.GetProperty("value").TryGetProperty("errorType", out _))
            .GetProperty("value").GetRawText();
        return Assert.IsType<OperationResponseV2>(RpcV2Contract.ParseResponse(json).Value);
    }

    private static JsonDocument ReadContractJson(string fileName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "protocol", "v2", fileName);
        Assert.True(File.Exists(path), $"Shared contract file was not copied to test output: {path}");
        return JsonDocument.Parse(File.ReadAllText(path));
    }

    private static string Failure(JsonElement fixture, IReadOnlyList<string> errors) =>
        $"{fixture.GetProperty("name").GetString()}: {string.Join("; ", errors)}";

    private static void AssertNames<T>(IEnumerable<T> expected, JsonElement actual) where T : struct, Enum =>
        AssertStrings(expected.Select(value => value.ToString()), actual);

    private static void AssertStrings(IEnumerable<string> expected, JsonElement actual) =>
        Assert.Equal(expected, actual.EnumerateArray().Select(value => value.GetString()!));
}
