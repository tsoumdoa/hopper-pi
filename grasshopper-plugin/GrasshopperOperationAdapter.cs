using System;
using System.Collections.Generic;
using System.Text.Json;
using Grasshopper;
using Grasshopper.Kernel;
using Hopper.Core.Grasshopper;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Adapts the existing Grasshopper operations to the Rhino-owned RPC runtime.
    /// It owns no sockets, child processes, or lifecycle state.
    /// </summary>
    public sealed class GrasshopperOperationAdapter : IGrasshopperAdapter
    {
        private static readonly HashSet<RpcOperation> QueryOperations = new HashSet<RpcOperation>
        {
            RpcOperation.listAllComponents,
            RpcOperation.getCurrentCanvas,
            RpcOperation.getCanvasErrors,
            RpcOperation.listScriptParams,
            RpcOperation.getScriptCode,
            RpcOperation.getParamRhinoGeometry,
        };

        private static readonly HashSet<RpcOperation> MutationOperations = new HashSet<RpcOperation>
        {
            RpcOperation.applyGraph,
            RpcOperation.addComponent,
            RpcOperation.deleteComponent,
            RpcOperation.connectWire,
            RpcOperation.disconnectWire,
            RpcOperation.moveComponent,
            RpcOperation.renameComponent,
            RpcOperation.setComponentLocked,
            RpcOperation.setComponentHidden,
            RpcOperation.addGroup,
            RpcOperation.removeFromGroup,
            RpcOperation.deleteGroup,
            RpcOperation.changeGroupColor,
            RpcOperation.renameGroup,
            RpcOperation.changeGroupStyle,
            RpcOperation.createSlider,
            RpcOperation.editSliderRange,
            RpcOperation.setSliderValue,
            RpcOperation.createPanel,
            RpcOperation.setPanelParams,
            RpcOperation.setPanelText,
            RpcOperation.createToggle,
            RpcOperation.setToggleValue,
            RpcOperation.createSwatch,
            RpcOperation.setSwatchColor,
            RpcOperation.createScribble,
            RpcOperation.setScribbleText,
            RpcOperation.createValueList,
            RpcOperation.setValueListSelected,
            RpcOperation.createScriptNode,
            RpcOperation.setScriptCode,
            RpcOperation.syncScriptParams,
            RpcOperation.addScriptInput,
            RpcOperation.removeScriptInput,
            RpcOperation.addScriptOutput,
            RpcOperation.removeScriptOutput,
            RpcOperation.editParamProps,
            RpcOperation.beginAgentTransaction,
            RpcOperation.commitAgentTransaction,
            RpcOperation.cancelAgentTransaction,
            RpcOperation.setParamRhinoGeometry,
        };

        private readonly CommandExecutor _commands = new CommandExecutor(_ => { });
        private readonly UiRequestDispatcher _queries = CreateQueryDispatcher();

        public OperationDocumentStatus DocumentStatus
        {
            get
            {
                var document = ActiveDocument;
                return document == null
                    ? OperationDocumentStatus.None
                    : new OperationDocumentStatus(
                        true,
                        string.IsNullOrWhiteSpace(document.FilePath)
                            ? "Untitled"
                            : document.FilePath);
            }
        }

        public bool CanExecute(RpcOperation operation) =>
            QueryOperations.Contains(operation) || MutationOperations.Contains(operation);

        public OperationResultV2 Execute(RpcRequestV2 request)
        {
            if (request == null)
                throw new ArgumentNullException(nameof(request));

            var document = ActiveDocument;
            if (document == null)
                return Failure(
                    RpcResultClass.no_active_grasshopper_document,
                    RpcReasonCode.NO_ACTIVE_GRASSHOPPER_DOCUMENT,
                    "No active Grasshopper document is available.");

            try
            {
                if (QueryOperations.Contains(request.Operation))
                {
                    if (!_queries.TryDispatch(
                        request.Operation.ToString(),
                        document,
                        request.Args,
                        out var response))
                    {
                        return Failure(
                            RpcResultClass.failed,
                            RpcReasonCode.UNKNOWN_OPERATION,
                            $"No Grasshopper query handles '{request.Operation}'.");
                    }
                    return FromJson(response);
                }

                if (request.Operation == RpcOperation.applyGraph)
                {
                    if (!_queries.TryDispatch("applyGraph", document, request.Args, out var response))
                        throw new InvalidOperationException("The applyGraph handler is unavailable.");
                    return FromJson(response);
                }

                var command = new GhCommand
                {
                    Action = request.Operation.ToString(),
                    Params = request.Args,
                };
                var result = _commands.Execute(document, command);
                if (IsFailure(result))
                    return Failure(RpcResultClass.failed, RpcReasonCode.OPERATION_FAILED, result);

                return Completed(JsonSerializer.SerializeToElement(
                    new { result },
                    RpcV2Contract.JsonOptions));
            }
            catch (Exception exception)
            {
                return Failure(
                    RpcResultClass.failed,
                    RpcReasonCode.OPERATION_FAILED,
                    $"{exception.GetType().Name}: {exception.Message}");
            }
        }

        public void CleanupOpenTransactions()
        {
            var document = ActiveDocument;
            if (document != null)
                AgentTransaction.Cancel(document);
        }

        private static GH_Document ActiveDocument => Instances.ActiveCanvas?.Document;

        private static UiRequestDispatcher CreateQueryDispatcher()
        {
            var dispatcher = new UiRequestDispatcher();
            dispatcher.Register("listAllComponents", new ListAllComponentsHandler());
            dispatcher.Register("getCurrentCanvas", new GetCurrentCanvasHandler());
            dispatcher.Register("getCanvasErrors", new GetCanvasErrorsHandler());
            dispatcher.Register("applyGraph", new ApplyGraphHandler());
            dispatcher.Register("listScriptParams", new ListScriptParamsHandler());
            dispatcher.Register("getScriptCode", new GetScriptCodeHandler());
            dispatcher.Register("getParamRhinoGeometry", new GetParamRhinoGeometryHandler());
            return dispatcher;
        }

        private static OperationResultV2 FromJson(string response)
        {
            using var document = JsonDocument.Parse(response);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("error", out var error))
            {
                return Failure(
                    RpcResultClass.failed,
                    RpcReasonCode.OPERATION_FAILED,
                    error.GetString() ?? "Grasshopper operation failed.");
            }

            return Completed(root.Clone());
        }

        private static bool IsFailure(string result) =>
            result.IndexOf(" error", StringComparison.OrdinalIgnoreCase) >= 0
            || result.StartsWith("Invalid ", StringComparison.OrdinalIgnoreCase)
            || result.StartsWith("Unknown ", StringComparison.OrdinalIgnoreCase);

        private static OperationResultV2 Completed(JsonElement data) => new OperationResultV2
        {
            Class = RpcResultClass.completed,
            ReasonCode = RpcReasonCode.OK,
            Data = data,
        };

        private static OperationResultV2 Failure(
            RpcResultClass resultClass,
            RpcReasonCode reason,
            string message) => new OperationResultV2
        {
            Class = resultClass,
            ReasonCode = reason,
            Message = message,
        };
    }
}
