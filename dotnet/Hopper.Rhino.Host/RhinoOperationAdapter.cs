using System.Text.Json;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Time;

namespace Hopper.Rhino.Host;

public sealed record RhinoObjectQueryArguments(
    bool? SelectionOnly,
    string? Layer,
    IReadOnlyList<string>? ObjectIds,
    string? ObjectType);

public sealed record RhinoScriptArguments(
    string? Mode,
    string? Source,
    bool Echo);

public sealed record RhinoObjectResult(
    string ObjectId,
    string Name,
    string Layer,
    string ObjectType);

public sealed record RhinoObjectQueryExecution(
    bool Succeeded,
    IReadOnlyList<RhinoObjectResult> Objects,
    string? Error = null);

public sealed record RhinoScriptExecution(
    bool Succeeded,
    string Output,
    string Error);

public interface IRhinoOperationExecutor
{
    OperationDocumentStatus DocumentStatus { get; }
    RhinoObjectQueryExecution QueryObjects(RhinoObjectQueryArguments arguments);
    RhinoScriptExecution RunScript(RhinoScriptArguments arguments);
}

public sealed class RhinoOperationAdapter : IRhinoOperationAdapter
{
    private readonly IRhinoOperationExecutor _executor;
    private readonly IHopperClock _clock;

    public RhinoOperationAdapter(IRhinoOperationExecutor executor, IHopperClock clock)
    {
        _executor = executor ?? throw new ArgumentNullException(nameof(executor));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
    }

    public OperationDocumentStatus DocumentStatus => _executor.DocumentStatus;

    public bool CanExecute(RpcOperation operation) =>
        operation is RpcOperation.queryRhinoObjects or RpcOperation.runRhinoScript;

    public OperationResultV2 Execute(RpcRequestV2 request)
    {
        ArgumentNullException.ThrowIfNull(request);
        try
        {
            return request.Operation switch
            {
                RpcOperation.queryRhinoObjects => QueryObjects(request.Args),
                RpcOperation.runRhinoScript => RunScript(request.Args),
                _ => Failure($"Rhino operation '{request.Operation}' is not supported by this adapter."),
            };
        }
        catch (Exception exception)
        {
            return Failure($"Invalid {request.Operation} request: {exception.Message}");
        }
    }

    private OperationResultV2 QueryObjects(JsonElement args)
    {
        var arguments = args.Deserialize<RhinoObjectQueryArguments>(RpcV2Contract.JsonOptions)
            ?? throw new InvalidOperationException("Query arguments are required.");
        var execution = _executor.QueryObjects(arguments);
        var data = new
        {
            type = "queryRhinoObjects.response",
            timestamp = _clock.UtcNow.ToUnixTimeMilliseconds(),
            objects = execution.Objects,
        };
        return execution.Succeeded
            ? Completed(data)
            : Failure(execution.Error ?? "Rhino object query failed.", data);
    }

    private OperationResultV2 RunScript(JsonElement args)
    {
        var arguments = args.Deserialize<RhinoScriptArguments>(RpcV2Contract.JsonOptions)
            ?? throw new InvalidOperationException("Script arguments are required.");
        var execution = _executor.RunScript(arguments);
        var data = new
        {
            type = "runRhinoScript.response",
            timestamp = _clock.UtcNow.ToUnixTimeMilliseconds(),
            ok = execution.Succeeded,
            output = execution.Output,
            error = execution.Error,
        };
        return execution.Succeeded
            ? Completed(data)
            : Failure(execution.Error, data);
    }

    private static OperationResultV2 Completed<T>(T data) => new()
    {
        Class = RpcResultClass.completed,
        ReasonCode = RpcReasonCode.OK,
        Data = JsonSerializer.SerializeToElement(data, RpcV2Contract.JsonOptions),
    };

    private static OperationResultV2 Failure(string message) => new()
    {
        Class = RpcResultClass.failed,
        ReasonCode = RpcReasonCode.OPERATION_FAILED,
        Message = message,
    };

    private static OperationResultV2 Failure<T>(string message, T data) => new()
    {
        Class = RpcResultClass.failed,
        ReasonCode = RpcReasonCode.OPERATION_FAILED,
        Message = message,
        Data = JsonSerializer.SerializeToElement(data, RpcV2Contract.JsonOptions),
    };
}
