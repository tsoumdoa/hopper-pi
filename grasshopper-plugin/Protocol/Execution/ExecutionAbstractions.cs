using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc.Protocol.Execution
{
    internal interface IBackendActionExecutor
    {
        ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, BackendAction action);
    }

    internal interface IUiThreadDispatcher
    {
        Task<T> InvokeAsync<T>(Func<T> work, CancellationToken serviceStopping);
    }

    internal interface IDocumentExecutionGate
    {
        Task<IDisposable> AcquireMutationAsync(
            string grasshopperDocumentId,
            TimeSpan timeout,
            CancellationToken serviceStopping);
    }

    internal interface IExecutionValidationHook
    {
        HopperError Validate(
            ExecuteActionsRequest request,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument);
    }

    internal interface IExecutionTransaction : IDisposable
    {
        TransactionResult Commit();
        TransactionResult Rollback();
    }

    internal interface IExecutionTransactionFactory
    {
        IExecutionTransaction Begin(
            string scope,
            string transactionName,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument);
    }

    internal sealed class AllowExecutionValidationHook : IExecutionValidationHook
    {
        public HopperError Validate(
            ExecuteActionsRequest request,
            GH_Document ghDocument,
            RhinoDoc rhinoDocument) => null;
    }

    internal sealed class RhinoUiThreadDispatcher : IUiThreadDispatcher
    {
        private readonly TimeSpan _timeout;

        public RhinoUiThreadDispatcher(TimeSpan timeout)
        {
            _timeout = timeout;
        }

        public Task<T> InvokeAsync<T>(Func<T> work, CancellationToken serviceStopping)
        {
            serviceStopping.ThrowIfCancellationRequested();
            return Task.FromResult(Utilities.RunOnUiThread(work, _timeout));
        }
    }

    internal sealed class DocumentExecutionGate : IDocumentExecutionGate
    {
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates =
            new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);

        public async Task<IDisposable> AcquireMutationAsync(
            string grasshopperDocumentId,
            TimeSpan timeout,
            CancellationToken serviceStopping)
        {
            if (string.IsNullOrWhiteSpace(grasshopperDocumentId))
                throw new ArgumentException("A Grasshopper document identity is required.", nameof(grasshopperDocumentId));

            var gate = _gates.GetOrAdd(grasshopperDocumentId, _ => new SemaphoreSlim(1, 1));
            if (!await gate.WaitAsync(timeout, serviceStopping).ConfigureAwait(false))
                throw new TimeoutException("The document execution gate is busy.");
            return new GateLease(gate);
        }

        private sealed class GateLease : IDisposable
        {
            private SemaphoreSlim _gate;

            public GateLease(SemaphoreSlim gate)
            {
                _gate = gate;
            }

            public void Dispose()
            {
                Interlocked.Exchange(ref _gate, null)?.Release();
            }
        }
    }
}
