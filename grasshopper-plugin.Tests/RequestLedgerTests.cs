using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using rhino_zmq_poc;
using rhino_zmq_poc.Protocol;
using rhino_zmq_poc.Protocol.Execution;
using Xunit;
using static Xunit.Skip;

namespace grasshopper_plugin.Tests
{
    public sealed class RequestLedgerTests
    {
        private static string RequestIdAt(DateTimeOffset issuedAt) =>
            "req_" + UlidFor(issuedAt.ToUnixTimeMilliseconds());

        private static string UlidFor(long milliseconds)
        {
            const string alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
            var timestamp = new char[10];
            long value = milliseconds;
            for (var index = 9; index >= 0; index--)
            {
                timestamp[index] = alphabet[(int)(value & 31)];
                value >>= 5;
            }
            return new string(timestamp) + "0000000000000000";
        }

        [Fact]
        public void Same_id_and_digest_returns_existing_entry()
        {
            var ledger = new RequestLedger(capacity: 4);
            var requestId = RequestIdAt(DateTimeOffset.UtcNow);

            var first = ledger.TryBegin(requestId, "digest-a");
            var second = ledger.TryBegin(requestId, "digest-a");

            Assert.Equal(LedgerDecision.Accepted, first.Decision);
            Assert.Equal(LedgerDecision.Existing, second.Decision);
            Assert.Equal(1, ledger.Count);
        }

        [Fact]
        public void Same_id_with_different_digest_conflicts_without_work()
        {
            var ledger = new RequestLedger(capacity: 4);
            var requestId = RequestIdAt(DateTimeOffset.UtcNow);
            ledger.TryBegin(requestId, "digest-a");

            var result = ledger.TryBegin(requestId, "digest-b");

            Assert.Equal(LedgerDecision.Conflict, result.Decision);
        }

        [Fact]
        public void Expired_ids_never_execute()
        {
            var now = DateTimeOffset.UtcNow;
            var ledger = new RequestLedger(capacity: 4, window: TimeSpan.FromHours(1), clock: () => now);
            var old = RequestIdAt(now.AddHours(-2));

            Assert.Equal(LedgerDecision.Expired, ledger.TryBegin(old, "digest").Decision);
        }

        [Fact]
        public void Capacity_exhaustion_rejects_without_evicting_unexpired_entries()
        {
            var now = DateTimeOffset.UtcNow;
            var ledger = new RequestLedger(capacity: 1, clock: () => now);

            Assert.Equal(LedgerDecision.Accepted, ledger.TryBegin(RequestIdAt(now), "digest-1").Decision);
            Assert.Equal(LedgerDecision.Busy, ledger.TryBegin(RequestIdAt(now.AddSeconds(1)), "digest-2").Decision);
            // The unexpired entry is still served with its digest.
            Assert.Equal(LedgerDecision.Existing, ledger.TryBegin(RequestIdAt(now), "digest-1").Decision);
        }

        [Fact]
        public void Complete_caches_terminal_response_for_status_queries()
        {
            var ledger = new RequestLedger(capacity: 4);
            var requestId = RequestIdAt(DateTimeOffset.UtcNow);
            ledger.TryBegin(requestId, "digest");
            var cached = new WireResponseDto<JsonElement> { Outcome = "succeeded" };

            Assert.True(ledger.Complete(requestId, "digest", "succeeded", cached));
            var status = ledger.GetStatus(requestId, "digest");
            Assert.Equal(LedgerDecision.Existing, status.Decision);
            Assert.Equal("succeeded", status.Entry.State);
            Assert.Same(cached, status.Entry.CachedResponse);

            // Same ID and digest replays the cached response instead of working.
            Assert.Equal(LedgerDecision.Existing, ledger.TryBegin(requestId, "digest").Decision);
        }

        [Fact]
        public void Status_for_unknown_request_is_not_found()
        {
            var ledger = new RequestLedger(capacity: 4);
            var result = ledger.GetStatus(RequestIdAt(DateTimeOffset.UtcNow), "digest");
            Assert.Equal(LedgerDecision.NotFound, result.Decision);
        }
    }

    public sealed class TransactionCoordinatorTests
    {
        private sealed class ScriptedExecutor : IBackendActionExecutor
        {
            public Func<BackendAction, ActionResult> OnExecute { get; set; }

            public ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, BackendAction action) =>
                OnExecute(action);
        }

        private sealed class InlineDispatcher : IUiThreadDispatcher
        {
            public Task<T> InvokeAsync<T>(Func<T> work, CancellationToken serviceStopping) =>
                Task.FromResult(work());
        }

        private sealed class FakeTransactionFactory : IExecutionTransactionFactory
        {
            public int Begun;
            public int Commits;
            public int Rollbacks;
            public TransactionResult CommitResult { get; set; } = new TransactionResult
            {
                Outcome = TransactionOutcomes.Committed,
                GrasshopperUndoRecorded = true,
            };
            public TransactionResult RollbackResult { get; set; } = new TransactionResult
            {
                Outcome = TransactionOutcomes.RolledBack,
                GrasshopperRolledBack = true,
            };

            public IExecutionTransaction Begin(
                string scope,
                string transactionName,
                GH_Document ghDocument,
                RhinoDoc rhinoDocument)
            {
                Begun++;
                return new FakeTransaction(this);
            }

            private sealed class FakeTransaction : IExecutionTransaction
            {
                private readonly FakeTransactionFactory _owner;

                public FakeTransaction(FakeTransactionFactory owner)
                {
                    _owner = owner;
                }

                public TransactionResult Commit()
                {
                    _owner.Commits++;
                    return _owner.CommitResult;
                }

                public TransactionResult Rollback()
                {
                    _owner.Rollbacks++;
                    return _owner.RollbackResult;
                }

                public void Dispose()
                {
                }
            }
        }

        private static BackendAction CommandAction(string action = "moveComponent") => new BackendAction
        {
            Kind = "command",
            Command = new LowLevelCommand { Action = action },
        };

        private static TransactionCoordinator Build(
            ScriptedExecutor executor,
            FakeTransactionFactory transactions,
            IExecutionValidationHook validation = null)
        {
            return new TransactionCoordinator(
                executor,
                new InlineDispatcher(),
                new DocumentExecutionGate(),
                validation ?? new AllowExecutionValidationHook(),
                transactions,
                TimeSpan.FromSeconds(5));
        }

        private static ExecuteActionsRequest Request(params BackendAction[] actions) => new ExecuteActionsRequest
        {
            RequestId = "req_test",
            ExpectedBackendId = "be_test",
            ExpectedGrasshopperDocumentId = "ghd_test",
            ExpectedRhinoDocumentId = null,
            Scope = MutationScopes.Grasshopper,
            TransactionName = "test",
            Actions = new System.Collections.Generic.List<BackendAction>(actions),
        };

        [SkippableFact]
        public async Task Success_commits_and_reports_succeeded()
        {
            Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
            await Success_commits_and_reports_succeeded_inner();
        }

        private async Task Success_commits_and_reports_succeeded_inner()
        {
            var executor = new ScriptedExecutor
            {
                OnExecute = _ => ActionResult.Success("done"),
            };
            var transactions = new FakeTransactionFactory();
            var response = await Build(executor, transactions).ExecuteAsync(
                Request(CommandAction(), CommandAction()), null, null, CancellationToken.None);

            Assert.Equal("succeeded", response.Outcome);
            Assert.Null(response.Error);
            Assert.Equal(2, response.Data.Actions.Count);
            Assert.All(response.Data.Actions, result => Assert.Equal("succeeded", result.Outcome));
            Assert.Equal(1, transactions.Commits);
            Assert.Equal(0, transactions.Rollbacks);
        }

        [SkippableFact]
        public async Task Failure_skips_remaining_actions_and_rolls_back()
        {
            Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
            await Failure_skips_remaining_actions_and_rolls_back_inner();
        }

        private async Task Failure_skips_remaining_actions_and_rolls_back_inner()
        {
            var executor = new ScriptedExecutor
            {
                OnExecute = action => action.Command.Action == "fail"
                    ? ActionResult.Failure("operation_failed", "boom")
                    : ActionResult.Success("ok"),
            };
            var transactions = new FakeTransactionFactory();
            var response = await Build(executor, transactions).ExecuteAsync(
                Request(CommandAction("fail"), CommandAction()), null, null, CancellationToken.None);

            Assert.Equal("failed", response.Outcome);
            Assert.NotNull(response.Error);
            Assert.Equal("failed", response.Data.Actions[0].Outcome);
            Assert.Equal("skipped", response.Data.Actions[1].Outcome);
            Assert.Equal(1, transactions.Rollbacks);
            Assert.Equal(0, transactions.Commits);
            Assert.True(response.Data.Transaction.GrasshopperRolledBack);
        }

        [SkippableFact]
        public async Task Rejected_validation_performs_no_transaction()
        {
            Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
            await Rejected_validation_performs_no_transaction_inner();
        }

        private async Task Rejected_validation_performs_no_transaction_inner()
        {
            var executor = new ScriptedExecutor { OnExecute = _ => ActionResult.Success("done") };
            var transactions = new FakeTransactionFactory();
            var validation = new DelegateValidationHook(_ => new HopperError
            {
                Code = "backend_conflict",
                Message = "wrong backend",
                Retryable = false,
            });

            var response = await Build(executor, transactions, validation).ExecuteAsync(
                Request(CommandAction()), null, null, CancellationToken.None);

            Assert.Equal("failed", response.Outcome);
            Assert.Equal("backend_conflict", response.Error.Code);
            Assert.Equal(0, transactions.Begun);
        }

        [SkippableFact]
        public async Task Handler_exception_becomes_failed_action_not_success()
        {
            Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
            await Handler_exception_becomes_failed_action_not_success_inner();
        }

        private async Task Handler_exception_becomes_failed_action_not_success_inner()
        {
            var executor = new ScriptedExecutor
            {
                OnExecute = _ => throw new InvalidOperationException("exploded"),
            };
            var transactions = new FakeTransactionFactory();
            var response = await Build(executor, transactions).ExecuteAsync(
                Request(CommandAction()), null, null, CancellationToken.None);

            Assert.Equal("failed", response.Outcome);
            Assert.NotNull(response.Error);
            Assert.Equal("operation_failed", response.Data.Actions[0].Error.Code);
        }

        private sealed class DelegateValidationHook : IExecutionValidationHook
        {
            private readonly Func<ExecuteActionsRequest, HopperError> _validate;

            public DelegateValidationHook(Func<ExecuteActionsRequest, HopperError> validate)
            {
                _validate = validate;
            }

            public HopperError Validate(
                ExecuteActionsRequest request,
                GH_Document ghDocument,
                RhinoDoc rhinoDocument) => _validate(request);
        }
    }
}
