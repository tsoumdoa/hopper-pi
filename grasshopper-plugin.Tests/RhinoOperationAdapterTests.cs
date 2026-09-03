using System.Text.Json;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Time;
using Hopper.Rhino.Host;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class RhinoOperationAdapterTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 3, 8, 30, 0, TimeSpan.Zero);

    [Fact]
    public void AdapterClaimsOnlyTheTwoRhinoOperations()
    {
        var adapter = CreateAdapter(new Executor());

        Assert.True(adapter.CanExecute(RpcOperation.queryRhinoObjects));
        Assert.True(adapter.CanExecute(RpcOperation.runRhinoScript));
        Assert.False(adapter.CanExecute(RpcOperation.captureRhinoView));
        Assert.False(adapter.CanExecute(RpcOperation.getCurrentCanvas));
    }

    [Fact]
    public void QueryMapsArgumentsAndReturnsTheLegacyDataShapeInsideV2Result()
    {
        var executor = new Executor
        {
            QueryResult = new RhinoObjectQueryExecution(
                true,
                new[] { new RhinoObjectResult("id-1", "Curve", "Model", "curve") }),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(RpcOperation.queryRhinoObjects, new
        {
            selectionOnly = true,
            layer = "Model",
            objectIds = new[] { "id-1" },
            objectType = "curve",
        }));

        Assert.Equal(RpcResultClass.completed, result.Class);
        Assert.Equal(RpcReasonCode.OK, result.ReasonCode);
        Assert.NotNull(executor.QueryArguments);
        Assert.True(executor.QueryArguments.SelectionOnly);
        Assert.Equal("Model", executor.QueryArguments.Layer);
        var data = result.Data!.Value;
        Assert.Equal("queryRhinoObjects.response", data.GetProperty("type").GetString());
        Assert.Equal(Now.ToUnixTimeMilliseconds(), data.GetProperty("timestamp").GetInt64());
        Assert.Equal("id-1", data.GetProperty("objects")[0].GetProperty("objectId").GetString());
    }

    [Fact]
    public void ScriptFailureUsesOperationFailedAndKeepsExecutionDetails()
    {
        var executor = new Executor
        {
            ScriptResult = new RhinoScriptExecution(false, "partial", "script failed"),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(RpcOperation.runRhinoScript, new
        {
            mode = "command",
            source = "_Line 0,0 1,1",
            echo = false,
        }));

        Assert.Equal(RpcResultClass.failed, result.Class);
        Assert.Equal(RpcReasonCode.OPERATION_FAILED, result.ReasonCode);
        Assert.Equal("script failed", result.Message);
        Assert.Equal("command", executor.ScriptArguments?.Mode);
        var data = result.Data!.Value;
        Assert.False(data.GetProperty("ok").GetBoolean());
        Assert.Equal("partial", data.GetProperty("output").GetString());
        Assert.Equal("script failed", data.GetProperty("error").GetString());
    }

    private static RhinoOperationAdapter CreateAdapter(Executor executor) =>
        new(executor, new Clock());

    private static RpcRequestV2 Request(RpcOperation operation, object args) => new()
    {
        Operation = operation,
        Args = JsonSerializer.SerializeToElement(args, RpcV2Contract.JsonOptions),
    };

    private sealed class Clock : IHopperClock
    {
        public DateTimeOffset UtcNow => Now;
    }

    private sealed class Executor : IRhinoOperationExecutor
    {
        public OperationDocumentStatus DocumentStatus { get; } =
            new(true, "Model.3dm");
        public RhinoObjectQueryExecution QueryResult { get; init; } =
            new(true, Array.Empty<RhinoObjectResult>());
        public RhinoScriptExecution ScriptResult { get; init; } =
            new(true, "", "");
        public RhinoObjectQueryArguments? QueryArguments { get; private set; }
        public RhinoScriptArguments? ScriptArguments { get; private set; }

        public RhinoObjectQueryExecution QueryObjects(RhinoObjectQueryArguments arguments)
        {
            QueryArguments = arguments;
            return QueryResult;
        }

        public RhinoScriptExecution RunScript(RhinoScriptArguments arguments)
        {
            ScriptArguments = arguments;
            return ScriptResult;
        }
    }
}
