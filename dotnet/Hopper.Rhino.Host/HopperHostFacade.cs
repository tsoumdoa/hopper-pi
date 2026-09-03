using System;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Transport;

namespace Hopper.Rhino.Host
{
    public sealed record HopperCommandReceipt(
        bool Accepted,
        string Message,
        LifecycleSnapshot Lifecycle);

    public sealed record HopperFacadeStatus(
        LifecycleSnapshot Lifecycle,
        GrasshopperCapabilityStatus Grasshopper,
        OperationDocumentStatus RhinoDocument,
        OperationDocumentStatus GrasshopperDocument);

    public interface IHopperHostFacade
    {
        HopperCommandReceipt RequestStart();
        HopperCommandReceipt RequestStop();
        HopperCommandReceipt RequestRestart();
        HopperFacadeStatus GetStatus();
        OperationResultV2 Execute(RpcRequestV2 request);
        void CloseForRhinoExit();
    }

    /// <summary>
    /// Rhino-facing coordination boundary. Concrete process, file, transport, and UI
    /// adapters are composed into the LifecycleController outside this class.
    /// </summary>
    public sealed class HopperHostFacade : IHopperHostFacade, IRpcOperationHandler
    {
        private readonly object _startGate = new object();
        private readonly LifecycleController _lifecycle;
        private readonly ILifecycleBackgroundScheduler _background;
        private readonly RhinoOperationRegistry _rhino;
        private readonly GrasshopperCapabilityRegistry _grasshopper;
        private readonly HostOperationRouter _operations;
        private CancellationTokenSource? _pendingStart;

        public HopperHostFacade(
            LifecycleController lifecycle,
            ILifecycleBackgroundScheduler background,
            RhinoOperationRegistry rhino,
            GrasshopperCapabilityRegistry grasshopper)
        {
            _lifecycle = lifecycle ?? throw new ArgumentNullException(nameof(lifecycle));
            _background = background ?? throw new ArgumentNullException(nameof(background));
            _rhino = rhino ?? throw new ArgumentNullException(nameof(rhino));
            _grasshopper = grasshopper ?? throw new ArgumentNullException(nameof(grasshopper));
            _operations = new HostOperationRouter(rhino, grasshopper);
        }

        public HopperCommandReceipt RequestStart()
        {
            lock (_startGate)
            {
                var snapshot = _lifecycle.Snapshot;
                if (_pendingStart != null
                    || snapshot.State is not (Hopper.Core.Lifecycle.LifecycleState.Stopped
                        or Hopper.Core.Lifecycle.LifecycleState.Faulted))
                {
                    return Rejected($"HopperCode is {snapshot.State.ToString().ToLowerInvariant()}.");
                }

                var pendingStart = new CancellationTokenSource();
                _pendingStart = pendingStart;
                try
                {
                    _ = _background.Schedule(() => StartInBackgroundAsync(pendingStart));
                }
                catch (Exception exception)
                {
                    _pendingStart = null;
                    pendingStart.Dispose();
                    return Rejected($"Could not schedule HopperCode start: {exception.Message}");
                }
                return new HopperCommandReceipt(true, "HopperCode start accepted.", snapshot);
            }
        }

        public HopperCommandReceipt RequestStop()
        {
            var cancelledPendingStart = CancelPendingStart();
            var result = _lifecycle.RequestStop();
            if (cancelledPendingStart && !result.Accepted)
            {
                return new HopperCommandReceipt(
                    true,
                    "HopperCode queued start cancelled.",
                    _lifecycle.Snapshot);
            }
            return FromLifecycle(result);
        }

        public HopperCommandReceipt RequestRestart()
        {
            CancelPendingStart();
            var result = _lifecycle.RequestRestart();
            return FromLifecycle(result);
        }

        public HopperFacadeStatus GetStatus()
        {
            var rhinoDocument = _rhino.TryGetAdapter(out var rhino)
                ? rhino!.DocumentStatus
                : OperationDocumentStatus.None;
            var grasshopperDocument = _grasshopper.TryGetAdapter(out var grasshopper)
                ? grasshopper!.DocumentStatus
                : OperationDocumentStatus.None;
            return new HopperFacadeStatus(
                _lifecycle.Snapshot,
                _grasshopper.Status,
                rhinoDocument,
                grasshopperDocument);
        }

        public OperationResultV2 Execute(RpcRequestV2 request) => _operations.Execute(request);

        public void CloseForRhinoExit()
        {
            CancelPendingStart();
            _lifecycle.CloseForRhinoExit();
        }

        private async Task StartInBackgroundAsync(CancellationTokenSource pendingStart)
        {
            try
            {
                if (!pendingStart.IsCancellationRequested)
                {
                    await _lifecycle.StartAsync(pendingStart.Token).ConfigureAwait(false);
                }
            }
            finally
            {
                lock (_startGate)
                {
                    if (ReferenceEquals(_pendingStart, pendingStart))
                        _pendingStart = null;
                }
                pendingStart.Dispose();
            }
        }

        private bool CancelPendingStart()
        {
            lock (_startGate)
            {
                if (_pendingStart == null)
                    return false;
                _pendingStart.Cancel();
                return true;
            }
        }

        private HopperCommandReceipt Rejected(string message) =>
            new(false, message, _lifecycle.Snapshot);

        private static HopperCommandReceipt FromLifecycle(LifecycleCommandResult result) =>
            new(result.Accepted, result.Message, result.Snapshot);
    }
}
