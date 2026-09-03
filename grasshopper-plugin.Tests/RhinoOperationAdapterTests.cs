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
    public void AdapterClaimsAllRhinoOperations()
    {
        var adapter = CreateAdapter(new Executor());

        Assert.True(adapter.CanExecute(RpcOperation.queryRhinoObjects));
        Assert.True(adapter.CanExecute(RpcOperation.runRhinoScript));
        Assert.True(adapter.CanExecute(RpcOperation.captureRhinoView));
        Assert.True(adapter.CanExecute(RpcOperation.controlRhinoView));
        Assert.True(adapter.CanExecute(RpcOperation.beginRhinoAgentTransaction));
        Assert.True(adapter.CanExecute(RpcOperation.commitRhinoAgentTransaction));
        Assert.True(adapter.CanExecute(RpcOperation.cancelRhinoAgentTransaction));
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

    [Fact]
    public void CaptureReturnsTheExistingNodeResponseShape()
    {
        var metadata = Metadata();
        var executor = new Executor
        {
            CaptureResult = new RhinoCaptureExecution(
                true, "cG5n", "image/png", null, metadata),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(RpcOperation.captureRhinoView, new
        {
            view = "Perspective",
            width = 800,
            height = 600,
            displayMode = "Rendered",
            transparentBackground = true,
            restoreView = false,
        }));

        Assert.Equal(RpcResultClass.completed, result.Class);
        Assert.Equal("Perspective", executor.CaptureArguments?.View);
        Assert.Equal(800, executor.CaptureArguments?.Width);
        var data = result.Data!.Value;
        Assert.Equal("captureRhinoView.response", data.GetProperty("type").GetString());
        Assert.Equal(Now.ToUnixTimeMilliseconds(), data.GetProperty("timestamp").GetInt64());
        Assert.True(data.GetProperty("ok").GetBoolean());
        Assert.Equal("cG5n", data.GetProperty("imageBase64").GetString());
        Assert.Equal("image/png", data.GetProperty("mediaType").GetString());
        Assert.Equal("Perspective", data.GetProperty("metadata").GetProperty("viewName").GetString());
    }

    [Fact]
    public void ControlFailureKeepsTypedResponseData()
    {
        var executor = new Executor
        {
            ControlResult = new RhinoControlExecution(false, "", "bad view", null),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(RpcOperation.controlRhinoView, new
        {
            action = "standardView",
            standardView = "sideways",
        }));

        Assert.Equal(RpcResultClass.failed, result.Class);
        Assert.Equal(RpcReasonCode.OPERATION_FAILED, result.ReasonCode);
        Assert.Equal("standardView", executor.ControlArguments?.Action);
        var data = result.Data!.Value;
        Assert.Equal("controlRhinoView.response", data.GetProperty("type").GetString());
        Assert.False(data.GetProperty("ok").GetBoolean());
        Assert.Equal("bad view", data.GetProperty("error").GetString());
        Assert.Equal("", data.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData(RpcOperation.beginRhinoAgentTransaction, "Begin")]
    [InlineData(RpcOperation.commitRhinoAgentTransaction, "Commit")]
    [InlineData(RpcOperation.cancelRhinoAgentTransaction, "Cancel")]
    public void TransactionOperationsReturnTheLegacyResultShape(
        RpcOperation operation,
        string expectedCall)
    {
        var executor = new Executor
        {
            TransactionResult = new RhinoTransactionExecution(true, "transaction complete"),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(operation, new { name = "Agent turn" }));

        Assert.Equal(RpcResultClass.completed, result.Class);
        Assert.Equal(expectedCall, executor.TransactionCall);
        Assert.Equal("transaction complete", result.Data!.Value.GetProperty("result").GetString());
        if (operation == RpcOperation.beginRhinoAgentTransaction)
            Assert.Equal("Agent turn", executor.TransactionName);
    }

    [Fact]
    public void TransactionFailureUsesOperationFailedAndKeepsResultText()
    {
        var executor = new Executor
        {
            TransactionResult = new RhinoTransactionExecution(
                false,
                "beginRhinoAgentTransaction error: undo disabled",
                "undo disabled"),
        };
        var adapter = CreateAdapter(executor);

        var result = adapter.Execute(Request(
            RpcOperation.beginRhinoAgentTransaction,
            new { name = "Agent turn" }));

        Assert.Equal(RpcResultClass.failed, result.Class);
        Assert.Equal(RpcReasonCode.OPERATION_FAILED, result.ReasonCode);
        Assert.Equal("undo disabled", result.Message);
        Assert.Equal(
            "beginRhinoAgentTransaction error: undo disabled",
            result.Data!.Value.GetProperty("result").GetString());
    }

    [Fact]
    public void LifecycleCleanupForwardsToTheRhinoExecutor()
    {
        var executor = new Executor();
        var adapter = CreateAdapter(executor);

        adapter.CleanupOpenTransactions();

        Assert.Equal(1, executor.CleanupCount);
    }

    private static RhinoViewMetadata Metadata() => new(
        "Perspective",
        "view-1",
        "perspective",
        new RhinoPoint3(1, 2, 3),
        new RhinoPoint3(4, 5, 6),
        new RhinoPoint3(0, 0, -1),
        new RhinoPoint3(0, 1, 0),
        50,
        "World Top",
        new RhinoPoint3(0, 0, 0),
        800,
        600);

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
        public RhinoCaptureExecution CaptureResult { get; init; } =
            new(true, "", "image/png", null, null);
        public RhinoControlExecution ControlResult { get; init; } =
            new(true, "", null, null);
        public RhinoTransactionExecution TransactionResult { get; init; } =
            new(true, "");
        public RhinoObjectQueryArguments? QueryArguments { get; private set; }
        public RhinoScriptArguments? ScriptArguments { get; private set; }
        public RhinoCaptureArguments? CaptureArguments { get; private set; }
        public RhinoControlArguments? ControlArguments { get; private set; }
        public string? TransactionCall { get; private set; }
        public string? TransactionName { get; private set; }
        public int CleanupCount { get; private set; }

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

        public RhinoCaptureExecution CaptureView(RhinoCaptureArguments arguments)
        {
            CaptureArguments = arguments;
            return CaptureResult;
        }

        public RhinoControlExecution ControlView(RhinoControlArguments arguments)
        {
            ControlArguments = arguments;
            return ControlResult;
        }

        public RhinoTransactionExecution BeginTransaction(string? name)
        {
            TransactionCall = "Begin";
            TransactionName = name;
            return TransactionResult;
        }

        public RhinoTransactionExecution CommitTransaction()
        {
            TransactionCall = "Commit";
            return TransactionResult;
        }

        public RhinoTransactionExecution CancelTransaction()
        {
            TransactionCall = "Cancel";
            return TransactionResult;
        }

        public void CleanupOpenTransactions() => CleanupCount++;
    }
}
