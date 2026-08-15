using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc.Protocol.Execution
{
    internal sealed class TransactionCoordinator
    {
        private readonly IBackendActionExecutor _actions;
        private readonly IUiThreadDispatcher _dispatcher;
        private readonly IDocumentExecutionGate _gate;
        private readonly IExecutionValidationHook _validation;
        private readonly IExecutionTransactionFactory _transactions;
        private readonly TimeSpan _gateTimeout;

        public TransactionCoordinator(
            IBackendActionExecutor actions,
            IUiThreadDispatcher dispatcher,
            IDocumentExecutionGate gate,
            IExecutionValidationHook validation,
            IExecutionTransactionFactory transactions,
            TimeSpan gateTimeout)
        {
            _actions = actions ?? throw new ArgumentNullException(nameof(actions));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _gate = gate ?? throw new ArgumentNullException(nameof(gate));
            _validation = validation ?? throw new ArgumentNullException(nameof(validation));
            _transactions = transactions ?? throw new ArgumentNullException(nameof(transactions));
            _gateTimeout = gateTimeout;
        }

        public async Task<ExecuteActionsResponse> ExecuteAsync(
            ExecuteActionsRequest request,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument,
            CancellationToken serviceStopping)
        {
            var requestError = ValidateRequest(request);
            if (requestError != null)
                return Rejected(request, requestError);

            var identityError = _validation.Validate(request, ghDocument, rhinoDocument);
            if (identityError != null)
                return Rejected(request, identityError);

            IDisposable lease;
            try
            {
                lease = await _gate.AcquireMutationAsync(
                    request.ExpectedGrasshopperDocumentId,
                    _gateTimeout,
                    serviceStopping).ConfigureAwait(false);
            }
            catch (TimeoutException ex)
            {
                return Rejected(request, Error("backend_busy", ex.Message, true));
            }
            catch (OperationCanceledException ex)
            {
                return Rejected(request, Error("backend_busy", ex.Message, true));
            }

            using (lease)
            {
                try
                {
                    return await _dispatcher.InvokeAsync(
                        () => ExecuteOnUiThread(request, ghDocument, rhinoDocument),
                        serviceStopping).ConfigureAwait(false);
                }
                catch (TimeoutException ex)
                {
                    return Unknown(request, Error("outcome_unknown", ex.Message, false));
                }
                catch (OperationCanceledException ex)
                {
                    return Unknown(request, Error("outcome_unknown", ex.Message, false));
                }
                catch (Exception ex)
                {
                    return Rejected(request, Error("operation_failed", ex.Message, false));
                }
            }
        }

        private ExecuteActionsResponse ExecuteOnUiThread(
            ExecuteActionsRequest request,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument)
        {
            var timer = Stopwatch.StartNew();
            using var transaction = _transactions.Begin(
                request.Scope,
                request.TransactionName,
                ghDocument,
                rhinoDocument);
            var results = new List<ActionResult>(request.Actions.Count);

            for (var index = 0; index < request.Actions.Count; index++)
            {
                var action = request.Actions[index];
                ActionResult result;
                var actionTimer = Stopwatch.StartNew();
                try
                {
                    result = _actions.Execute(ghDocument, rhinoDocument, action)
                        ?? ActionResult.Failure("operation_failed", "The action handler returned no result.");
                }
                catch (Exception ex)
                {
                    result = ActionResult.Failure("operation_failed", ex.Message);
                }
                actionTimer.Stop();
                NormalizeActionResult(result, action, index, actionTimer.ElapsedMilliseconds);
                results.Add(result);

                if (result.Outcome == ExecutionOutcomes.Succeeded)
                    continue;

                for (var skippedIndex = index + 1; skippedIndex < request.Actions.Count; skippedIndex++)
                    results.Add(Skipped(request.Actions[skippedIndex], skippedIndex));

                var rollback = transaction.Rollback();
                timer.Stop();
                return CompleteAfterFailure(request, results, rollback, result, timer.ElapsedMilliseconds);
            }

            var committed = transaction.Commit();
            timer.Stop();
            if (committed.Outcome == TransactionOutcomes.Unknown)
                return Build(request, ExecutionOutcomes.Unknown, results, committed,
                    Error("outcome_unknown", "The transaction commit outcome is unknown.", false), timer.ElapsedMilliseconds);
            if (committed.Outcome == TransactionOutcomes.Partial)
                return Build(request, ExecutionOutcomes.Partial, results, committed,
                    Error("partial_mutation", "The transaction committed only partially.", false), timer.ElapsedMilliseconds);
            return Build(request, ExecutionOutcomes.Succeeded, results, committed, null, timer.ElapsedMilliseconds);
        }

        private static ExecuteActionsResponse CompleteAfterFailure(
            ExecuteActionsRequest request,
            List<ActionResult> results,
            TransactionResult transaction,
            ActionResult failedAction,
            long elapsedMs)
        {
            if (failedAction.Outcome == ExecutionOutcomes.Unknown || transaction.Outcome == TransactionOutcomes.Unknown)
            {
                return Build(request, ExecutionOutcomes.Unknown, results, transaction,
                    failedAction.Error ?? Error("outcome_unknown", failedAction.Message, false), elapsedMs);
            }
            if (transaction.Outcome == TransactionOutcomes.Partial)
            {
                return Build(request, ExecutionOutcomes.Partial, results, transaction,
                    Error("partial_mutation", failedAction.Message, false), elapsedMs);
            }
            return Build(request, ExecutionOutcomes.Failed, results, transaction,
                failedAction.Error ?? Error("operation_failed", failedAction.Message, false), elapsedMs);
        }

        private static void NormalizeActionResult(
            ActionResult result,
            BackendAction action,
            int index,
            long elapsedMs)
        {
            result.Index = index;
            result.Kind = action?.Kind ?? "unknown";
            result.Action = action?.Command?.Action;
            result.ElapsedMs = elapsedMs;
            if (result.Outcome != ExecutionOutcomes.Succeeded
                && result.Outcome != ExecutionOutcomes.Failed
                && result.Outcome != ExecutionOutcomes.Unknown)
            {
                result.Outcome = ExecutionOutcomes.Failed;
                result.Message = "The action handler returned an invalid outcome.";
                result.Error = Error("internal_error", result.Message, false);
            }
            if (result.Outcome == ExecutionOutcomes.Succeeded)
                result.Error = null;
            else if (result.Error == null)
                result.Error = Error(
                    result.Outcome == ExecutionOutcomes.Unknown ? "outcome_unknown" : "operation_failed",
                    result.Message,
                    false);
        }

        private static ActionResult Skipped(BackendAction action, int index) => new ActionResult
        {
            Index = index,
            Kind = action?.Kind ?? "unknown",
            Action = action?.Command?.Action,
            Outcome = ExecutionOutcomes.Skipped,
            Message = "Skipped because an earlier action did not succeed.",
            Data = null,
            Error = null,
            ElapsedMs = 0,
        };

        private static HopperError ValidateRequest(ExecuteActionsRequest request)
        {
            if (request == null)
                return Error("invalid_command", "An executeActions request is required.", false);
            if (!MutationScopes.IsValid(request.Scope))
                return Error("invalid_input", $"Unsupported mutation scope '{request.Scope}'.", false);
            if (request.Actions == null || request.Actions.Count == 0)
                return Error("invalid_input", "At least one backend action is required.", false);
            if (string.IsNullOrWhiteSpace(request.ExpectedGrasshopperDocumentId))
                return Error("invalid_input", "expectedGrasshopperDocumentId is required.", false);
            return null;
        }

        private static ExecuteActionsResponse Rejected(ExecuteActionsRequest request, HopperError error) =>
            Build(request, ExecutionOutcomes.Failed, new List<ActionResult>(), TransactionResult.Unchanged(), error, 0);

        private static ExecuteActionsResponse Unknown(ExecuteActionsRequest request, HopperError error) =>
            Build(request, ExecutionOutcomes.Unknown, new List<ActionResult>(), new TransactionResult
            {
                Outcome = TransactionOutcomes.Unknown,
                Limitations = new List<string> { "UI-thread work may still have completed." },
            }, error, 0);

        private static ExecuteActionsResponse Build(
            ExecuteActionsRequest request,
            string outcome,
            List<ActionResult> actions,
            TransactionResult transaction,
            HopperError error,
            long elapsedMs) => new ExecuteActionsResponse
        {
            RequestId = request?.RequestId,
            Outcome = outcome,
            Data = new ExecuteActionsData
            {
                PayloadSha256 = request?.PayloadSha256,
                Actions = actions,
                Transaction = transaction,
                ElapsedMs = elapsedMs,
            },
            Error = error,
        };

        private static HopperError Error(string code, string message, bool retryable) => new HopperError
        {
            Code = code,
            Message = string.IsNullOrWhiteSpace(message) ? code : message,
            Retryable = retryable,
        };
    }

    internal sealed class LegacyAgentTransactionFactory : IExecutionTransactionFactory
    {
        public IExecutionTransaction Begin(
            string scope,
            string transactionName,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument) =>
            new LegacyAgentTransaction(scope, transactionName, ghDocument, rhinoDocument);

        private sealed class LegacyAgentTransaction : IExecutionTransaction
        {
            private readonly string _scope;
            private readonly GH_Document _ghDocument;
            private readonly RhinoDoc _rhinoDocument;
            private readonly byte[] _beforeGrasshopper;
            private bool _grasshopperActive;
            private bool _rhinoActive;
            private bool _completed;

            public LegacyAgentTransaction(
                string scope,
                string transactionName,
                GH_Document ghDocument,
                RhinoDoc rhinoDocument)
            {
                _scope = scope;
                _ghDocument = ghDocument;
                _rhinoDocument = rhinoDocument;
                var name = string.IsNullOrWhiteSpace(transactionName) ? "Hopper operation" : transactionName;

                if (IncludesGrasshopper(scope))
                {
                    if (ghDocument == null) throw new InvalidOperationException("No Grasshopper document is active.");
                    if (AgentTransaction.IsActive) throw new InvalidOperationException("A Grasshopper transaction is already active.");
                    _beforeGrasshopper = DocumentSnapshots.Serialize(ghDocument)
                        ?? throw new InvalidOperationException("Could not snapshot the Grasshopper document.");
                    AgentTransaction.Begin(ghDocument, name);
                    if (!AgentTransaction.IsActive) throw new InvalidOperationException("Could not start the Grasshopper transaction.");
                    _grasshopperActive = true;
                }

                if (IncludesRhino(scope))
                {
                    if (rhinoDocument == null)
                    {
                        CloseGrasshopper();
                        throw new InvalidOperationException("No Rhino document is active.");
                    }
                    if (RhinoAgentTransaction.IsActive)
                    {
                        CloseGrasshopper();
                        throw new InvalidOperationException("A Rhino transaction is already active.");
                    }
                    RhinoAgentTransaction.Begin(rhinoDocument, name);
                    if (!RhinoAgentTransaction.IsActive)
                    {
                        CloseGrasshopper();
                        throw new InvalidOperationException("Could not start the Rhino transaction.");
                    }
                    _rhinoActive = true;
                }
            }

            public TransactionResult Commit()
            {
                EnsureOpen();
                var grasshopperChanged = _grasshopperActive
                    && !DocumentSnapshots.AreEqual(_beforeGrasshopper, DocumentSnapshots.Serialize(_ghDocument));
                if (_grasshopperActive)
                {
                    AgentTransaction.Commit(_ghDocument);
                    _grasshopperActive = false;
                }
                if (_rhinoActive)
                {
                    RhinoAgentTransaction.Commit(_rhinoDocument);
                    _rhinoActive = false;
                }
                _completed = true;
                return new TransactionResult
                {
                    Outcome = grasshopperChanged || IncludesRhino(_scope)
                        ? TransactionOutcomes.Committed
                        : TransactionOutcomes.Unchanged,
                    GrasshopperUndoRecorded = grasshopperChanged,
                    RhinoUndoRecorded = IncludesRhino(_scope),
                };
            }

            public TransactionResult Rollback()
            {
                EnsureOpen();
                var grasshopperRolledBack = false;
                if (_grasshopperActive)
                {
                    AgentTransaction.Cancel(_ghDocument);
                    _grasshopperActive = false;
                    grasshopperRolledBack = DocumentSnapshots.AreEqual(
                        _beforeGrasshopper,
                        DocumentSnapshots.Serialize(_ghDocument));
                }
                if (_rhinoActive)
                {
                    RhinoAgentTransaction.Cancel(_rhinoDocument);
                    _rhinoActive = false;
                }
                _completed = true;
                var includesRhino = IncludesRhino(_scope);
                return new TransactionResult
                {
                    Outcome = includesRhino
                        ? TransactionOutcomes.Partial
                        : grasshopperRolledBack ? TransactionOutcomes.RolledBack : TransactionOutcomes.Unknown,
                    GrasshopperRolledBack = grasshopperRolledBack,
                    RhinoRolledBack = false,
                    Limitations = includesRhino
                        ? new List<string> { "Rhino rollback is not guaranteed for arbitrary scripts or commands." }
                        : new List<string>(),
                };
            }

            public void Dispose()
            {
                if (!_completed)
                    Rollback();
            }

            private void EnsureOpen()
            {
                if (_completed) throw new InvalidOperationException("The transaction is already complete.");
            }

            private void CloseGrasshopper()
            {
                if (!_grasshopperActive) return;
                AgentTransaction.Cancel(_ghDocument);
                _grasshopperActive = false;
            }

            private static bool IncludesGrasshopper(string scope) =>
                scope == MutationScopes.Grasshopper || scope == MutationScopes.Mixed;

            private static bool IncludesRhino(string scope) =>
                scope == MutationScopes.Rhino || scope == MutationScopes.Mixed;
        }
    }
}
