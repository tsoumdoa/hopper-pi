using Hopper.Core.Dispatching;
using Hopper.Core.Time;

namespace Hopper.Core.Lifecycle;

public sealed class LifecycleController
{
    private readonly SemaphoreSlim _commandGate = new(1, 1);
    private readonly object _snapshotGate = new();
    private readonly object _intentGate = new();
    private readonly object _restartGate = new();
    private readonly INodeRuntimeProvider _nodeRuntime;
    private readonly ILifecycleTransport _transport;
    private readonly IInstanceProfileStore _profiles;
    private readonly IManagedChildProcess _child;
    private readonly ILifecycleDispatcher _dispatcher;
    private readonly IAgentTransactionCleanup _transactions;
    private readonly ILifecycleInstanceIdSource _instanceIds;
    private readonly ILifecycleBackgroundScheduler _background;
    private readonly IHopperClock _clock;
    private readonly LifecycleOptions _options;
    private LifecycleSnapshot _snapshot;
    private CancellationTokenSource? _activeStartCancellation;
    private Task<LifecycleCommandResult>? _stopTask;
    private Task<LifecycleCommandResult>? _restartTask;
    private int _closing;

    public LifecycleController(
        INodeRuntimeProvider nodeRuntime,
        ILifecycleTransport transport,
        IInstanceProfileStore profiles,
        IManagedChildProcess child,
        ILifecycleDispatcher dispatcher,
        IAgentTransactionCleanup transactions,
        ILifecycleInstanceIdSource instanceIds,
        ILifecycleBackgroundScheduler background,
        IHopperClock clock,
        LifecycleOptions? options = null)
    {
        _nodeRuntime = nodeRuntime ?? throw new ArgumentNullException(nameof(nodeRuntime));
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _profiles = profiles ?? throw new ArgumentNullException(nameof(profiles));
        _child = child ?? throw new ArgumentNullException(nameof(child));
        _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
        _transactions = transactions ?? throw new ArgumentNullException(nameof(transactions));
        _instanceIds = instanceIds ?? throw new ArgumentNullException(nameof(instanceIds));
        _background = background ?? throw new ArgumentNullException(nameof(background));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _options = options ?? LifecycleOptions.Default;
        ValidateOptions(_options);

        _snapshot = new LifecycleSnapshot(
            0,
            _clock.UtcNow,
            LifecycleState.Stopped,
            LifecycleReasonCode.Initialized,
            "HopperCode is stopped.",
            null,
            0);
        _dispatcher.CloseExternalAdmission();
        _dispatcher.CancelQueuedExternal();
    }

    public LifecycleSnapshot Snapshot
    {
        get
        {
            lock (_snapshotGate)
                return _snapshot;
        }
    }

    public Task<LifecycleCommandResult> StartAsync(CancellationToken cancellationToken = default)
    {
        var state = Snapshot.State;
        return state is LifecycleState.Stopped or LifecycleState.Faulted
            ? RunCommandAsync(StartUnderGateAsync, cancellationToken)
            : Task.FromResult(Ignored($"HopperCode is {state.ToString().ToLowerInvariant()}."));
    }

    public LifecycleCommandResult RequestStop() =>
        EnsureStopRequested("HopperCode stop accepted.").Request;

    public Task<LifecycleCommandResult> StopAsync() =>
        EnsureStopRequested("HopperCode stop accepted.").Completion;

    public LifecycleCommandResult RequestRestart()
    {
        EnsureRestartRequested();
        return Accepted("HopperCode restart accepted.");
    }

    public Task<LifecycleCommandResult> RestartAsync() => EnsureRestartRequested();

    private Task<LifecycleCommandResult> EnsureRestartRequested()
    {
        TaskCompletionSource<LifecycleCommandResult>? completion = null;
        Task<LifecycleCommandResult> task;
        lock (_restartGate)
        {
            if (_restartTask != null)
                return _restartTask;

            completion = new TaskCompletionSource<LifecycleCommandResult>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            _restartTask = completion.Task;
            task = _restartTask;
        }

        Task<LifecycleCommandResult>? stopCompletion = null;
        if (Snapshot.State is LifecycleState.Starting or LifecycleState.Running or LifecycleState.Stopping)
        {
            stopCompletion = EnsureStopRequested("HopperCode restart accepted.").Completion;
        }
        _ = _background.Schedule(() => CompleteRestartAsync(completion, stopCompletion));
        return task;
    }

    public Task ReportUnexpectedChildExitAsync() =>
        RunBackgroundEventAsync(
            LifecycleReasonCode.UnexpectedChildExit,
            "The Node child exited unexpectedly; an interrupted mutation may have an unknown outcome.",
            stopChild: false);

    public async Task ReportHealthCheckAsync(bool healthy)
    {
        await _commandGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var snapshot = Snapshot;
            if (snapshot.State != LifecycleState.Running || IsClosing)
                return;

            if (healthy)
            {
                if (snapshot.ConsecutiveHealthFailures > 0)
                {
                    Transition(
                        LifecycleState.Running,
                        LifecycleReasonCode.HealthCheckRecovered,
                        "Node health recovered.",
                        snapshot.LifecycleInstanceId,
                        0);
                }
                return;
            }

            var failures = checked(snapshot.ConsecutiveHealthFailures + 1);
            if (failures < _options.HealthFailureThreshold)
            {
                Transition(
                    LifecycleState.Running,
                    LifecycleReasonCode.HealthCheckFailed,
                    $"Node health check failed ({failures}/{_options.HealthFailureThreshold}).",
                    snapshot.LifecycleInstanceId,
                    failures);
                return;
            }

            Transition(
                LifecycleState.Faulted,
                LifecycleReasonCode.HealthFailureThresholdReached,
                $"Node failed {_options.HealthFailureThreshold} consecutive health checks.",
                snapshot.LifecycleInstanceId,
                failures);
            await CleanupAfterFaultAsync(snapshot.LifecycleInstanceId, stopChild: true)
                .ConfigureAwait(false);
        }
        finally
        {
            _commandGate.Release();
        }
    }

    public void CloseForRhinoExit()
    {
        if (Interlocked.Exchange(ref _closing, 1) != 0)
            return;

        CancellationTokenSource? activeStart;
        lock (_intentGate)
        {
            var snapshot = Snapshot;
            Transition(
                LifecycleState.Stopping,
                LifecycleReasonCode.RhinoClosing,
                "Rhino is closing.",
                snapshot.LifecycleInstanceId,
                snapshot.ConsecutiveHealthFailures);
            activeStart = _activeStartCancellation;
        }
        _dispatcher.CloseExternalAdmission();
        _dispatcher.CancelQueuedExternal();
        activeStart?.Cancel();

        // Rhino shutdown must not wait for UI work, but a queued best-effort cleanup
        // can still restore an open Grasshopper snapshot or close a Rhino undo record.
        _ = _dispatcher.SubmitLifecycleControl(_transactions.CleanupOpenTransactions);

        try
        {
            _transport.SignalStopNoWait();
        }
        catch
        {
        }

        try
        {
            _child.KillVerifiedTreeNoWait();
        }
        catch
        {
        }
    }

    private bool IsClosing => Volatile.Read(ref _closing) != 0;

    private async Task<LifecycleCommandResult> RunCommandAsync(
        Func<Task<LifecycleCommandResult>> command,
        CancellationToken cancellationToken)
    {
        await _commandGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (IsClosing)
                return Ignored("Rhino is closing.");
            return await command().ConfigureAwait(false);
        }
        finally
        {
            _commandGate.Release();
        }
    }

    private async Task CompleteRestartAsync(
        TaskCompletionSource<LifecycleCommandResult> completion,
        Task<LifecycleCommandResult>? stopCompletion)
    {
        try
        {
            if (IsClosing)
            {
                completion.TrySetResult(Ignored("Rhino is closing."));
                return;
            }

            if (stopCompletion == null
                && Snapshot.State is (LifecycleState.Starting or LifecycleState.Running or LifecycleState.Stopping))
            {
                stopCompletion = EnsureStopRequested("HopperCode restart accepted.").Completion;
            }
            if (stopCompletion != null)
            {
                var stopResult = await stopCompletion.ConfigureAwait(false);
                if (Snapshot.State != LifecycleState.Stopped)
                {
                    completion.TrySetResult(stopResult);
                    return;
                }
            }

            completion.TrySetResult(
                await RunCommandAsync(StartUnderGateAsync, CancellationToken.None)
                    .ConfigureAwait(false));
        }
        catch (Exception exception)
        {
            completion.TrySetException(exception);
        }
        finally
        {
            lock (_restartGate)
                _restartTask = null;
        }
    }

    private async Task<LifecycleCommandResult> StartUnderGateAsync()
    {
        var current = Snapshot;
        if (current.State is not (LifecycleState.Stopped or LifecycleState.Faulted))
            return Ignored($"HopperCode is {current.State.ToString().ToLowerInvariant()}.");

        if (current.State == LifecycleState.Faulted)
        {
            var oldCleanup = await CleanupResourcesAsync(
                    current.LifecycleInstanceId,
                    stopChild: true,
                    cleanupTransactions: false)
                .ConfigureAwait(false);
            if (oldCleanup.FatalReason.HasValue)
            {
                Transition(
                    LifecycleState.Faulted,
                    oldCleanup.FatalReason.Value,
                    oldCleanup.Message,
                    current.LifecycleInstanceId,
                    current.ConsecutiveHealthFailures);
                return Accepted(oldCleanup.Message);
            }
        }

        CancellationTokenSource startCancellation;
        string instanceId;
        lock (_intentGate)
        {
            current = Snapshot;
            if (current.State is not (LifecycleState.Stopped or LifecycleState.Faulted))
                return Ignored($"HopperCode is {current.State.ToString().ToLowerInvariant()}.");

            startCancellation = new CancellationTokenSource();
            _activeStartCancellation = startCancellation;
            instanceId = _instanceIds.Create();
            Transition(
                LifecycleState.Starting,
                LifecycleReasonCode.StartRequested,
                "HopperCode start accepted.",
                instanceId,
                0);
        }
        _dispatcher.CloseExternalAdmission();
        _dispatcher.CancelQueuedExternal();

        var created = new StartResources();
        var failureReason = LifecycleReasonCode.NodeResolutionFailed;
        var cancellationToken = startCancellation.Token;
        try
        {
            var resolution = await _nodeRuntime.ResolveAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            if (!resolution.IsSuccess || resolution.Runtime == null)
            {
                var message = resolution.Error?.Message ?? "Node runtime resolution failed.";
                return await FailStartAsync(failureReason, message, instanceId, created)
                    .ConfigureAwait(false);
            }
            if (IsClosing)
                return await AbortStartForClosingAsync(instanceId, created).ConfigureAwait(false);

            failureReason = LifecycleReasonCode.TransportStartFailed;
            var transport = await _transport.StartAsync(instanceId, cancellationToken)
                .ConfigureAwait(false);
            created.Transport = transport.ResourceCreated;
            cancellationToken.ThrowIfCancellationRequested();
            if (!transport.Succeeded || transport.Connection == null)
            {
                return await FailStartAsync(
                        failureReason,
                        NonEmpty(transport.Message, "Transport startup failed."),
                        instanceId,
                        created)
                    .ConfigureAwait(false);
            }
            if (IsClosing)
                return await AbortStartForClosingAsync(instanceId, created).ConfigureAwait(false);

            failureReason = LifecycleReasonCode.ProfileWriteFailed;
            var profile = await _profiles.WriteAsync(
                    instanceId,
                    transport.Connection,
                    cancellationToken)
                .ConfigureAwait(false);
            created.Profile = profile.ResourceCreated;
            cancellationToken.ThrowIfCancellationRequested();
            if (!profile.Succeeded || string.IsNullOrWhiteSpace(profile.ProfilePath))
            {
                return await FailStartAsync(
                        failureReason,
                        NonEmpty(profile.Message, "Instance profile creation failed."),
                        instanceId,
                        created)
                    .ConfigureAwait(false);
            }
            if (IsClosing)
                return await AbortStartForClosingAsync(instanceId, created).ConfigureAwait(false);

            failureReason = LifecycleReasonCode.ChildLaunchFailed;
            var child = await _child.StartAsync(
                    resolution.Runtime,
                    profile.ProfilePath,
                    instanceId,
                    cancellationToken)
                .ConfigureAwait(false);
            created.Child = child.ResourceCreated;
            cancellationToken.ThrowIfCancellationRequested();
            if (!child.Succeeded)
            {
                return await FailStartAsync(
                        failureReason,
                        NonEmpty(child.Message, "Node child launch failed."),
                        instanceId,
                        created)
                    .ConfigureAwait(false);
            }
            if (IsClosing)
                return await AbortStartForClosingAsync(instanceId, created).ConfigureAwait(false);

            failureReason = LifecycleReasonCode.HandshakeFailed;
            var handshake = await _transport.WaitForAuthenticatedHandshakeAsync(
                    instanceId,
                    _options.HandshakeTimeout,
                    cancellationToken)
                .ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            if (!handshake.Succeeded)
            {
                return await FailStartAsync(
                        failureReason,
                        NonEmpty(handshake.Message, "Authenticated transport handshake failed."),
                        instanceId,
                        created)
                    .ConfigureAwait(false);
            }
            if (IsClosing)
                return await AbortStartForClosingAsync(instanceId, created).ConfigureAwait(false);

            var dispatcherOpened = false;
            lock (_intentGate)
            {
                cancellationToken.ThrowIfCancellationRequested();
                dispatcherOpened = _dispatcher.ReopenExternalAdmission();
                if (dispatcherOpened)
                {
                    Transition(
                        LifecycleState.Running,
                        LifecycleReasonCode.Started,
                        "HopperCode is running.",
                        instanceId,
                        0);
                }
            }
            if (!dispatcherOpened)
            {
                return await FailStartAsync(
                        LifecycleReasonCode.DispatcherUnavailable,
                        "The dispatcher cannot accept work.",
                        instanceId,
                        created)
                    .ConfigureAwait(false);
            }
            return Accepted("HopperCode is running.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return Accepted(IsClosing ? "Rhino is closing." : "HopperCode stop accepted.");
        }
        catch (Exception exception)
        {
            return await FailStartAsync(
                    failureReason,
                    exception.Message,
                    instanceId,
                    created)
                .ConfigureAwait(false);
        }
        finally
        {
            lock (_intentGate)
            {
                if (ReferenceEquals(_activeStartCancellation, startCancellation))
                    _activeStartCancellation = null;
            }
            startCancellation.Dispose();
        }
    }

    private StopRequest EnsureStopRequested(string message)
    {
        TaskCompletionSource<LifecycleCommandResult>? completion;
        CancellationTokenSource? activeStart;
        LifecycleCommandResult request;
        lock (_intentGate)
        {
            var current = Snapshot;
            if (current.State == LifecycleState.Stopped)
            {
                var ignored = Ignored("HopperCode is already stopped.");
                return new StopRequest(ignored, Task.FromResult(ignored));
            }
            if (current.State == LifecycleState.Stopping && _stopTask != null)
                return new StopRequest(Ignored("HopperCode is already stopping."), _stopTask);

            completion = new TaskCompletionSource<LifecycleCommandResult>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            _stopTask = completion.Task;
            Transition(
                LifecycleState.Stopping,
                LifecycleReasonCode.StopRequested,
                message,
                current.LifecycleInstanceId,
                current.ConsecutiveHealthFailures);
            activeStart = _activeStartCancellation;
            request = Accepted(message);
        }

        _dispatcher.CloseExternalAdmission();
        _dispatcher.CancelQueuedExternal();
        activeStart?.Cancel();
        _ = _background.Schedule(() => CompleteStopAsync(completion));
        return new StopRequest(request, completion.Task);
    }

    private async Task CompleteStopAsync(
        TaskCompletionSource<LifecycleCommandResult> completion)
    {
        try
        {
            await _commandGate.WaitAsync().ConfigureAwait(false);
            try
            {
                completion.TrySetResult(
                    IsClosing
                        ? Ignored("Rhino is closing.")
                        : await CompleteStopUnderGateAsync().ConfigureAwait(false));
            }
            finally
            {
                _commandGate.Release();
            }
        }
        catch (Exception exception)
        {
            completion.TrySetException(exception);
        }
        finally
        {
            lock (_intentGate)
            {
                if (ReferenceEquals(_stopTask, completion.Task))
                    _stopTask = null;
            }
        }
    }

    private async Task<LifecycleCommandResult> CompleteStopUnderGateAsync()
    {
        var current = Snapshot;
        if (current.State != LifecycleState.Stopping)
            return Ignored($"HopperCode is {current.State.ToString().ToLowerInvariant()}.");

        var cleanup = await CleanupResourcesAsync(
                current.LifecycleInstanceId,
                stopChild: true,
                cleanupTransactions: true)
            .ConfigureAwait(false);
        if (cleanup.FatalReason.HasValue)
        {
            Transition(
                LifecycleState.Faulted,
                cleanup.FatalReason.Value,
                cleanup.Message,
                current.LifecycleInstanceId,
                current.ConsecutiveHealthFailures);
            return Accepted(cleanup.Message);
        }

        var message = string.IsNullOrEmpty(cleanup.Warning)
            ? "HopperCode stopped."
            : $"HopperCode stopped. {cleanup.Warning}";
        Transition(
            LifecycleState.Stopped,
            LifecycleReasonCode.Stopped,
            message,
            null,
            0);
        return Accepted(message);
    }

    private async Task<LifecycleCommandResult> FailStartAsync(
        LifecycleReasonCode reason,
        string message,
        string instanceId,
        StartResources created)
    {
        if (Snapshot.State == LifecycleState.Stopping)
            return Accepted("HopperCode stop accepted.");

        var rollback = await RollbackStartAsync(instanceId, created).ConfigureAwait(false);
        if (IsClosing || Snapshot.State == LifecycleState.Stopping)
            return Accepted(IsClosing ? "Rhino is closing." : "HopperCode stop accepted.");

        var finalReason = rollback.FatalReason ?? reason;
        var finalMessage = rollback.FatalReason.HasValue
            ? rollback.Message
            : message;
        Transition(LifecycleState.Faulted, finalReason, finalMessage, instanceId, 0);
        return Accepted(finalMessage);
    }

    private async Task<LifecycleCommandResult> AbortStartForClosingAsync(
        string instanceId,
        StartResources created)
    {
        await RollbackStartAsync(instanceId, created).ConfigureAwait(false);
        return Accepted("Rhino is closing.");
    }

    private async Task<CleanupOutcome> RollbackStartAsync(
        string instanceId,
        StartResources created)
    {
        if (created.Child)
        {
            try
            {
                _child.KillVerifiedTreeNoWait();
                if (!await _child.WaitForExitAsync(
                        _options.KilledChildExitTimeout,
                        CancellationToken.None)
                    .ConfigureAwait(false))
                {
                    return CleanupOutcome.Fatal(
                        LifecycleReasonCode.ChildStillAlive,
                        "The Node child did not exit after startup rollback.");
                }
            }
            catch (Exception exception)
            {
                return CleanupOutcome.Fatal(
                    LifecycleReasonCode.ChildStillAlive,
                    $"Could not stop the Node child after startup failure: {exception.Message}");
            }
        }

        if (created.Transport)
        {
            try
            {
                if (!await _transport.StopAsync(
                        _options.TransportStopTimeout,
                        CancellationToken.None)
                    .ConfigureAwait(false))
                {
                    return CleanupOutcome.Fatal(
                        LifecycleReasonCode.TransportStopTimeout,
                        "The transport did not stop after startup failure.");
                }
            }
            catch (Exception exception)
            {
                return CleanupOutcome.Fatal(
                    LifecycleReasonCode.TransportStopTimeout,
                    $"Could not stop the transport after startup failure: {exception.Message}");
            }
        }

        if (created.Profile)
        {
            var deleted = await DeleteProfileAsync(instanceId).ConfigureAwait(false);
            if (!deleted.Succeeded)
            {
                return CleanupOutcome.Fatal(
                    LifecycleReasonCode.ProfileDeleteFailed,
                    deleted.Message);
            }
        }
        return CleanupOutcome.Success();
    }

    private async Task<CleanupOutcome> CleanupResourcesAsync(
        string? instanceId,
        bool stopChild,
        bool cleanupTransactions)
    {
        var transactionFailure = cleanupTransactions
            ? await ScheduleTransactionCleanupAsync().ConfigureAwait(false)
            : null;
        var childGone = !stopChild || !_child.IsAlive;

        if (stopChild && !childGone)
        {
            try
            {
                childGone = await _child.RequestGracefulStopAsync(
                        _options.GracefulChildStopTimeout,
                        CancellationToken.None)
                    .ConfigureAwait(false);
                if (!childGone)
                {
                    _child.KillVerifiedTreeNoWait();
                    childGone = await _child.WaitForExitAsync(
                            _options.KilledChildExitTimeout,
                            CancellationToken.None)
                        .ConfigureAwait(false);
                }
            }
            catch
            {
                childGone = false;
            }
        }

        if (!childGone)
        {
            return CleanupOutcome.Fatal(
                LifecycleReasonCode.ChildStillAlive,
                "The Node child is still alive after its stop deadlines.",
                transactionFailure?.Message);
        }

        var transportGone = !_transport.IsRunning;
        if (!transportGone)
        {
            try
            {
                transportGone = await _transport.StopAsync(
                        _options.TransportStopTimeout,
                        CancellationToken.None)
                    .ConfigureAwait(false);
            }
            catch
            {
                transportGone = false;
            }
        }
        if (!transportGone)
        {
            return CleanupOutcome.Fatal(
                LifecycleReasonCode.TransportStopTimeout,
                "The transport did not stop before its deadline.",
                transactionFailure?.Message);
        }

        if (!string.IsNullOrEmpty(instanceId))
        {
            var deleted = await DeleteProfileAsync(instanceId).ConfigureAwait(false);
            if (!deleted.Succeeded)
            {
                return CleanupOutcome.Fatal(
                    LifecycleReasonCode.ProfileDeleteFailed,
                    deleted.Message,
                    transactionFailure?.Message);
            }
        }
        return transactionFailure ?? CleanupOutcome.Success();
    }

    private async Task<CleanupOutcome?> ScheduleTransactionCleanupAsync()
    {
        try
        {
            var result = await _dispatcher.SubmitLifecycleControl(
                    _transactions.CleanupOpenTransactions,
                    _clock.UtcNow + _options.TransactionCleanupStartTimeout,
                    cancellationToken: CancellationToken.None)
                .ConfigureAwait(false);
            if (result.Kind == DispatcherResultKind.Completed)
                return null;

            var reason = result.Kind == DispatcherResultKind.DeadlineExceededBeforeStart
                ? LifecycleReasonCode.TransactionCleanupTimeout
                : LifecycleReasonCode.TransactionCleanupFailed;
            return CleanupOutcome.Fatal(
                reason,
                $"Transaction cleanup failed ({result.Code}).");
        }
        catch (Exception exception)
        {
            return CleanupOutcome.Fatal(
                LifecycleReasonCode.TransactionCleanupFailed,
                $"Transaction cleanup failed: {exception.Message}");
        }
    }

    private async Task<LifecycleActionResult> DeleteProfileAsync(string instanceId)
    {
        try
        {
            return await _profiles.DeleteOwnedAsync(instanceId, CancellationToken.None)
                .ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            return LifecycleActionResult.Failure(
                $"Could not delete the owned instance profile: {exception.Message}");
        }
    }

    private async Task RunBackgroundEventAsync(
        LifecycleReasonCode reason,
        string message,
        bool stopChild)
    {
        await _commandGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var current = Snapshot;
            if (current.State != LifecycleState.Running || IsClosing)
                return;

            Transition(
                LifecycleState.Faulted,
                reason,
                message,
                current.LifecycleInstanceId,
                current.ConsecutiveHealthFailures);
            await CleanupAfterFaultAsync(current.LifecycleInstanceId, stopChild)
                .ConfigureAwait(false);
        }
        finally
        {
            _commandGate.Release();
        }
    }

    private async Task CleanupAfterFaultAsync(string? instanceId, bool stopChild)
    {
        _dispatcher.CloseExternalAdmission();
        _dispatcher.CancelQueuedExternal();
        var original = Snapshot;
        var cleanup = await CleanupResourcesAsync(
                instanceId,
                stopChild,
                cleanupTransactions: true)
            .ConfigureAwait(false);
        if (IsClosing || Snapshot.State == LifecycleState.Stopping)
            return;

        if (cleanup.FatalReason.HasValue)
        {
            Transition(
                LifecycleState.Faulted,
                cleanup.FatalReason.Value,
                cleanup.Message,
                instanceId,
                original.ConsecutiveHealthFailures);
        }
        else if (!string.IsNullOrEmpty(cleanup.Warning))
        {
            Transition(
                LifecycleState.Faulted,
                original.Reason,
                $"{original.Message} {cleanup.Warning}",
                instanceId,
                original.ConsecutiveHealthFailures);
        }
    }

    private LifecycleCommandResult Accepted(string message) =>
        new(true, message, Snapshot);

    private LifecycleCommandResult Ignored(string message) =>
        new(false, message, Snapshot);

    private void Transition(
        LifecycleState state,
        LifecycleReasonCode reason,
        string message,
        string? instanceId,
        int healthFailures)
    {
        lock (_snapshotGate)
        {
            _snapshot = new LifecycleSnapshot(
                checked(_snapshot.Revision + 1),
                _clock.UtcNow,
                state,
                reason,
                message,
                instanceId,
                healthFailures);
        }
    }

    private static string NonEmpty(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value;

    private static void ValidateOptions(LifecycleOptions options)
    {
        if (options.HandshakeTimeout <= TimeSpan.Zero
            || options.GracefulChildStopTimeout <= TimeSpan.Zero
            || options.KilledChildExitTimeout <= TimeSpan.Zero
            || options.TransportStopTimeout <= TimeSpan.Zero
            || options.TransactionCleanupStartTimeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                "Lifecycle timeouts must be positive.");
        }
        if (options.HealthFailureThreshold <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                "Health failure threshold must be positive.");
        }
    }

    private sealed class StartResources
    {
        public bool Transport { get; set; }
        public bool Profile { get; set; }
        public bool Child { get; set; }
    }

    private sealed record StopRequest(
        LifecycleCommandResult Request,
        Task<LifecycleCommandResult> Completion);

    private sealed record CleanupOutcome(
        LifecycleReasonCode? FatalReason,
        string Message,
        string? Warning)
    {
        public static CleanupOutcome Success(string? warning = null) =>
            new(null, string.Empty, warning);

        public static CleanupOutcome Fatal(
            LifecycleReasonCode reason,
            string message,
            string? warning = null) =>
            new(reason, message, warning);
    }
}
