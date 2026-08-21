using System.Text.Json;
using System.IO;
using Grasshopper.Kernel;
using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public class TargetIdentityContractTests
{
    [Fact]
    public void Ping_response_reports_backend_start_and_exact_document_target_shape()
    {
        var response = new PingResponse
        {
            Timestamp = 1_700_000_000_123,
            BackendStartedAt = 1_700_000_000_000,
            Target = SavedTarget(),
        };

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(response));
        var root = json.RootElement;

        Assert.Equal("ping.response", root.GetProperty("type").GetString());
        Assert.Equal(1_700_000_000_000, root.GetProperty("backendStartedAt").GetInt64());
        AssertTarget(root.GetProperty("target"));
        Assert.DoesNotContain("active", root.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Five_prototype_operation_responses_echo_the_same_target_contract()
    {
        object[] responses =
        {
            new GetCurrentCanvasResponse { Target = SavedTarget(), DocName = "/tmp/connected.gh", Xml = "" },
			new GetCanvasErrorsResponse { Target = SavedTarget(), DocName = "/tmp/connected.gh", Errors = new() },
            new ListAllComponentsResponse { Target = SavedTarget(), Components = new() },
            new ApplyGraphResponse { Target = SavedTarget() },
            new QueryRhinoObjectsResponse { Target = SavedTarget(), Objects = new() },
            new RunRhinoScriptResponse { Target = SavedTarget(), Output = "", Error = "" },
        };

        foreach (var response in responses)
        {
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(response, response.GetType()));
            AssertTarget(json.RootElement.GetProperty("target"));
        }
    }

    [Fact]
    public void Unsaved_connected_document_uses_null_path_and_stable_runtime_id()
    {
        var doc = new GH_Document();
        var provider = new TargetIdentityProvider(() => "backend-123");

        var target = provider.Capture(doc, null);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(target));
        var ghDocument = json.RootElement.GetProperty("ghDocument");

        Assert.Equal(JsonValueKind.Null, ghDocument.GetProperty("path").ValueKind);
        Assert.Equal(doc.RuntimeID.ToString(), ghDocument.GetProperty("runtimeId").GetString());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("rhinoDocument").ValueKind);
    }

	[Fact]
	public void Zmq_service_never_logs_request_bodies()
	{
		var servicePath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "grasshopper-plugin", "services", "ZMqService.cs");
		var source = File.ReadAllText(Path.GetFullPath(servicePath));
		Assert.DoesNotContain("Received: {message}", source, StringComparison.Ordinal);
	}

    private static DocumentTarget SavedTarget()
    {
        return new DocumentTarget
        {
            BackendInstanceId = "backend-123",
            GhDocument = new GrasshopperDocumentTarget
            {
                Path = "/tmp/connected.gh",
                RuntimeId = "gh-runtime-456",
            },
            RhinoDocument = new RhinoDocumentTarget
            {
                Name = "model.3dm",
                RuntimeSerialNumber = 789,
            },
        };
    }

    private static void AssertTarget(JsonElement target)
    {
        Assert.Equal("backend-123", target.GetProperty("backendInstanceId").GetString());

        var ghDocument = target.GetProperty("ghDocument");
        Assert.Equal("/tmp/connected.gh", ghDocument.GetProperty("path").GetString());
        Assert.Equal("gh-runtime-456", ghDocument.GetProperty("runtimeId").GetString());

        var rhinoDocument = target.GetProperty("rhinoDocument");
        Assert.Equal("model.3dm", rhinoDocument.GetProperty("name").GetString());
        Assert.Equal((uint)789, rhinoDocument.GetProperty("runtimeSerialNumber").GetUInt32());
    }
}
