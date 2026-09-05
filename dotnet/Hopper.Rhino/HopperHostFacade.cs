#nullable enable

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
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
        OperationDocumentStatus GrasshopperDocument,
        RuntimeStatusV2 Runtime);

    public interface IHopperCommandCompletionSink
    {
        void Write(string message);
    }

    public interface IHopperRunningObserver
    {
        void Reset();
        void OnRunning();
    }

    public interface IGrasshopperStartController
    {
        bool StartGrasshopper();
    }

    public interface IHopperOperationCancellation
    {
        CancelOperationState Cancel(string operationId);
    }

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
        private readonly RuntimeStatusStore _status;
        private readonly IHopperRunningObserver? _runningObserver;
        private readonly IHopperCommandCompletionSink? _completionSink;
        private readonly Action? _reopenBrowser;
        private readonly IGrasshopperStartController _grasshopperStart;
        private readonly IHopperOperationCancellation _operationCancellation;
        private CancellationTokenSource? _pendingStart;

        public HopperHostFacade(
            LifecycleController lifecycle,
            ILifecycleBackgroundScheduler background,
            RhinoOperationRegistry rhino,
            GrasshopperCapabilityRegistry grasshopper,
            RuntimeStatusStore status,
            IGrasshopperStartController grasshopperStart,
            IHopperOperationCancellation operationCancellation,
            IHopperRunningObserver? runningObserver = null,
            IHopperCommandCompletionSink? completionSink = null,
            Action? reopenBrowser = null)
        {
            _lifecycle = lifecycle ?? throw new ArgumentNullException(nameof(lifecycle));
            _background = background ?? throw new ArgumentNullException(nameof(background));
            _rhino = rhino ?? throw new ArgumentNullException(nameof(rhino));
            _grasshopper = grasshopper ?? throw new ArgumentNullException(nameof(grasshopper));
            _status = status ?? throw new ArgumentNullException(nameof(status));
            _grasshopperStart = grasshopperStart ?? throw new ArgumentNullException(nameof(grasshopperStart));
            _operationCancellation = operationCancellation ?? throw new ArgumentNullException(nameof(operationCancellation));
            _runningObserver = runningObserver;
            _completionSink = completionSink;
            _reopenBrowser = reopenBrowser;
            _operations = new HostOperationRouter(rhino, grasshopper);
        }

        public HopperCommandReceipt RequestStart()
        {
            lock (_startGate)
            {
                var snapshot = _lifecycle.Snapshot;
                if (snapshot.State == Hopper.Core.Lifecycle.LifecycleState.Running
                    && _reopenBrowser != null)
                {
                    try
                    {
                        _ = _background.Schedule(() =>
                        {
                            if (IsCurrentRunningInstance(snapshot))
                            {
                                SyncStatus();
                                _reopenBrowser();
                            }
                            return Task.CompletedTask;
                        });
                    }
                    catch (Exception exception)
                    {
                        return Rejected($"Could not reopen Hopper browser: {exception.Message}");
                    }
                    return new HopperCommandReceipt(true, "HopperCode browser reopen requested.", snapshot);
                }
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
            SyncStatus();
            _runningObserver?.Reset();
            if (cancelledPendingStart && !result.Accepted)
            {
                return new HopperCommandReceipt(
                    true,
                    "HopperCode queued start cancelled.",
                    _lifecycle.Snapshot);
            }
            if (result.Accepted)
                _ = _background.Schedule(ObserveStopCompletionAsync);
            return FromLifecycle(result);
        }

        public HopperCommandReceipt RequestRestart()
        {
            CancelPendingStart();
            var result = _lifecycle.RequestRestart();
            SyncStatus();
            _runningObserver?.Reset();
            _ = _background.Schedule(ObserveRestartCompletionAsync);
            return FromLifecycle(result);
        }

        public HopperFacadeStatus GetStatus()
        {
            SyncStatus();
            var runtime = _status.Read();
            var rhinoDocument = new OperationDocumentStatus(
                runtime.Rhino.ActiveDocument,
                runtime.Rhino.DocumentName);
            var grasshopperDocument = new OperationDocumentStatus(
                runtime.Grasshopper.ActiveDocument,
                runtime.Grasshopper.DocumentName);
            return new HopperFacadeStatus(
                _lifecycle.Snapshot,
                _grasshopper.Status,
                rhinoDocument,
                grasshopperDocument,
                runtime);
        }

        public OperationResultV2 Execute(RpcRequestV2 request)
        {
            return request.Operation switch
            {
                RpcOperation.getRuntimeStatus => Completed(GetStatus().Runtime),
                RpcOperation.startGrasshopper => StartGrasshopper(),
                RpcOperation.cancelOperation => CancelOperation(request),
                _ => _operations.Execute(request),
            };
        }

        public void CloseForRhinoExit()
        {
            CancelPendingStart();
            _lifecycle.CloseForRhinoExit();
            SyncStatus();
            _runningObserver?.Reset();
        }

        private async Task StartInBackgroundAsync(CancellationTokenSource pendingStart)
        {
            try
            {
                if (!pendingStart.IsCancellationRequested)
                {
                    var result = await _lifecycle.StartAsync(pendingStart.Token).ConfigureAwait(false);
                    SyncStatus();
                    if (IsCurrentRunningInstance(result.Snapshot))
                        _runningObserver?.OnRunning();
                    _completionSink?.Write(result.Message);
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

        private OperationResultV2 StartGrasshopper()
        {
            var capability = _grasshopper.Status;
            if (capability.State == GrasshopperCapabilityState.Ready)
                return Completed(new StartGrasshopperDataV2 { State = StartGrasshopperState.already_ready });
            if (capability.State == GrasshopperCapabilityState.Loading)
                return Completed(new StartGrasshopperDataV2 { State = StartGrasshopperState.start_requested });

            if (capability.State == GrasshopperCapabilityState.NotInstalled)
            {
                return Failure<StartGrasshopperDataV2>(
                    RpcResultClass.capability_unavailable,
                    RpcReasonCode.GRASSHOPPER_NOT_INSTALLED,
                    "The packaged Hopper.Grasshopper assembly was not found.");
            }
            if (!_grasshopper.MarkLoading())
                return Failed(RpcReasonCode.GRASSHOPPER_START_FAILED, "Grasshopper could not enter loading state.");

            try
            {
                if (!_grasshopperStart.StartGrasshopper())
                {
                    const string message = "Rhino could not start the supported Grasshopper command.";
                    _grasshopper.MarkFailed(
                        RpcReasonCode.GRASSHOPPER_START_FAILED.ToString(),
                        message);
                    SyncStatus();
                    return Failed(RpcReasonCode.GRASSHOPPER_START_FAILED, message);
                }
            }
            catch (Exception exception)
            {
                _grasshopper.MarkFailed(RpcReasonCode.GRASSHOPPER_START_FAILED.ToString(), exception.Message);
                SyncStatus();
                return Failed(RpcReasonCode.GRASSHOPPER_START_FAILED, exception.Message);
            }

            SyncStatus();
            return Completed(new StartGrasshopperDataV2 { State = StartGrasshopperState.start_requested });
        }

        private OperationResultV2 CancelOperation(RpcRequestV2 request)
        {
            var operationId = request.Args.Deserialize<OperationReferenceArgsV2>(RpcV2Contract.JsonOptions)!.OperationId;
            var state = _operationCancellation.Cancel(operationId);
            var data = new CancelOperationDataV2 { State = state };
            return state switch
            {
                CancelOperationState.cancelled_before_start or CancelOperationState.already_cancelled =>
                    Completed(data),
                CancelOperationState.rejected_already_started => Failure(
                    RpcResultClass.failed,
                    RpcReasonCode.CANCELLATION_REJECTED_ALREADY_STARTED,
                    "The operation already started.",
                    data),
                CancelOperationState.not_found => Failure(
                    RpcResultClass.failed,
                    RpcReasonCode.OPERATION_FAILED,
                    "The operation was not found.",
                    data),
                _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
            };
        }

        private async Task ObserveStopCompletionAsync()
        {
            var result = await _lifecycle.StopAsync().ConfigureAwait(false);
            SyncStatus();
            _completionSink?.Write(result.Message);
        }

        private async Task ObserveRestartCompletionAsync()
        {
            var result = await _lifecycle.RestartAsync().ConfigureAwait(false);
            SyncStatus();
            if (IsCurrentRunningInstance(result.Snapshot))
                _runningObserver?.OnRunning();
            _completionSink?.Write(result.Message);
        }

        private void SyncStatus()
        {
            _status.UpdateLifecycle(_lifecycle.Snapshot);
            var current = _status.Read().Grasshopper;
            var capability = _grasshopper.Status;
            var activeDocument = capability.State == GrasshopperCapabilityState.Ready
                && current.ActiveDocument;
            _status.UpdateGrasshopper(
                capability,
                activeDocument,
                activeDocument ? current.DocumentName : null);
        }

        private bool IsCurrentRunningInstance(LifecycleSnapshot completed)
        {
            var current = _lifecycle.Snapshot;
            return completed.State == Hopper.Core.Lifecycle.LifecycleState.Running
                && current.State == Hopper.Core.Lifecycle.LifecycleState.Running
                && string.Equals(
                    current.LifecycleInstanceId,
                    completed.LifecycleInstanceId,
                    StringComparison.Ordinal);
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

        private static OperationResultV2 Completed<T>(T value) => new()
        {
            Class = RpcResultClass.completed,
            ReasonCode = RpcReasonCode.OK,
            Data = JsonSerializer.SerializeToElement(value, RpcV2Contract.JsonOptions),
        };

        private static OperationResultV2 Failed(RpcReasonCode reason, string message) => new()
        {
            Class = RpcResultClass.failed,
            ReasonCode = reason,
            Message = message,
        };

        private static OperationResultV2 Failure<T>(
            RpcResultClass resultClass,
            RpcReasonCode reason,
            string message,
            T? data = default) => new()
            {
                Class = resultClass,
                ReasonCode = reason,
                Message = message,
                Data = data is null
                    ? null
                    : JsonSerializer.SerializeToElement(data, RpcV2Contract.JsonOptions),
            };
    }
}
