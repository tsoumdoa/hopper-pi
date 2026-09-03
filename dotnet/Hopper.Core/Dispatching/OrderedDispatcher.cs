using Hopper.Core.Time;

namespace Hopper.Core.Dispatching;

public enum DispatcherCancellationState
{
    CancelledBeforeStart,
    RejectedAlreadyStarted,
    NotFound,
}

/// <summary>
/// Owns admission and ordering for atomic work that must execute on a host UI thread.
/// External work is bounded and FIFO. Lifecycle work has a separate reserved queue and
/// runs immediately after the current callback, before queued external work.
/// </summary>
public sealed class OrderedDispatcher : ILifecycleDispatcher
{
    public const int DefaultCapacity = 64;
    public const int DefaultLifecycleCapacity = 1;

    private readonly object _gate = new();
    private readonly IUiCallbackScheduler _scheduler;
    private readonly IHopperClock _clock;
    private readonly int _externalCapacity;
    private readonly int _lifecycleCapacity;
    private readonly LinkedList<WorkItem> _externalQueue = new();
    private readonly LinkedList<WorkItem> _lifecycleQueue = new();
    private bool _acceptingExternalWork = true;
    private bool _shutdown;
    private bool _pumpPosted;
    private bool _running;
    private WorkItem? _runningItem;

    public event Action<DispatcherStatus>? StatusChanged;

    public OrderedDispatcher(
        IUiCallbackScheduler scheduler,
        IHopperClock clock,
        int capacity = DefaultCapacity,
        int lifecycleCapacity = DefaultLifecycleCapacity)
    {
        _scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        if (capacity <= 0)
            throw new ArgumentOutOfRangeException(nameof(capacity), "Capacity must be positive.");
        if (lifecycleCapacity <= 0)
            throw new ArgumentOutOfRangeException(nameof(lifecycleCapacity), "Lifecycle capacity must be positive.");

        _externalCapacity = capacity;
        _lifecycleCapacity = lifecycleCapacity;
    }

    public DispatcherStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new DispatcherStatus(
                    _acceptingExternalWork,
                    _shutdown,
                    _running,
                    _externalQueue.Count,
                    _externalCapacity,
                    _lifecycleQueue.Count,
                    _lifecycleCapacity);
            }
        }
    }

    public Task<DispatcherResult<T>> SubmitExternal<T>(
        Func<T> operation,
        DateTimeOffset startDeadlineAt,
        CancellationToken cancellationToken = default,
        string? operationId = null)
    {
        return Submit(operation, startDeadlineAt, cancellationToken, lifecycleControl: false, operationId);
    }

    public Task<DispatcherResult<T>> SubmitLifecycleControl<T>(
        Func<T> operation,
        DateTimeOffset? startDeadlineAt = null,
        CancellationToken cancellationToken = default)
    {
        return Submit(operation, startDeadlineAt, cancellationToken, lifecycleControl: true, operationId: null);
    }

    public Task<DispatcherResult<bool>> SubmitLifecycleControl(
        Action operation,
        DateTimeOffset? startDeadlineAt = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return SubmitLifecycleControl(
            () =>
            {
                operation();
                return true;
            },
            startDeadlineAt,
            cancellationToken);
    }

    public void CloseExternalAdmission()
    {
        var changed = false;
        lock (_gate)
        {
            if (_acceptingExternalWork)
            {
                _acceptingExternalWork = false;
                changed = true;
            }
        }
        if (changed)
            NotifyStatusChanged();
    }

    public bool ReopenExternalAdmission()
    {
        var changed = false;
        lock (_gate)
        {
            if (_shutdown)
                return false;

            if (!_acceptingExternalWork)
            {
                _acceptingExternalWork = true;
                changed = true;
            }
        }
        if (changed)
            NotifyStatusChanged();
        return true;
    }

    public int CancelQueuedExternal()
    {
        List<WorkItem> cancelled;
        lock (_gate)
        {
            cancelled = DrainQueue(_externalQueue);
        }

        foreach (var item in cancelled)
            item.CompleteBeforeStart(DispatcherResultKind.CancelledBeforeStart);
        if (cancelled.Count > 0)
            NotifyStatusChanged();
        return cancelled.Count;
    }

    public DispatcherCancellationState CancelQueuedExternal(string operationId)
    {
        if (string.IsNullOrWhiteSpace(operationId))
            throw new ArgumentException("An operation ID is required.", nameof(operationId));

        WorkItem? cancelled = null;
        lock (_gate)
        {
            if (string.Equals(_runningItem?.OperationId, operationId, StringComparison.Ordinal))
                return DispatcherCancellationState.RejectedAlreadyStarted;

            for (var node = _externalQueue.First; node != null; node = node.Next)
            {
                if (!string.Equals(node.Value.OperationId, operationId, StringComparison.Ordinal))
                    continue;
                cancelled = node.Value;
                _externalQueue.Remove(node);
                cancelled.Node = null;
                break;
            }
        }

        if (cancelled == null)
            return DispatcherCancellationState.NotFound;
        cancelled.CompleteBeforeStart(DispatcherResultKind.CancelledBeforeStart);
        NotifyStatusChanged();
        return DispatcherCancellationState.CancelledBeforeStart;
    }

    public void Shutdown()
    {
        List<WorkItem> rejected;
        lock (_gate)
        {
            if (_shutdown)
                return;

            _shutdown = true;
            _acceptingExternalWork = false;
            rejected = DrainQueue(_lifecycleQueue);
            rejected.AddRange(DrainQueue(_externalQueue));
        }

        foreach (var item in rejected)
            item.CompleteBeforeStart(DispatcherResultKind.ShuttingDown);
        NotifyStatusChanged();
    }

    private Task<DispatcherResult<T>> Submit<T>(
        Func<T> operation,
        DateTimeOffset? startDeadlineAt,
        CancellationToken cancellationToken,
        bool lifecycleControl,
        string? operationId)
    {
        ArgumentNullException.ThrowIfNull(operation);

        WorkItem<T>? item = null;
        DispatcherResult<T>? rejection = null;
        var shouldPost = false;

        lock (_gate)
        {
            if (_shutdown || (!lifecycleControl && !_acceptingExternalWork))
            {
                rejection = DispatcherResult<T>.ShuttingDown();
            }
            else if (IsExpired(startDeadlineAt))
            {
                rejection = DispatcherResult<T>.DeadlineExceededBeforeStart();
            }
            else if (cancellationToken.IsCancellationRequested)
            {
                rejection = DispatcherResult<T>.CancelledBeforeStart();
            }
            else
            {
                var queue = lifecycleControl ? _lifecycleQueue : _externalQueue;
                var capacity = lifecycleControl ? _lifecycleCapacity : _externalCapacity;
                if (queue.Count >= capacity)
                {
                    rejection = DispatcherResult<T>.Busy(queue.Count, capacity);
                }
                else
                {
                    item = new WorkItem<T>(operation, startDeadlineAt, cancellationToken, operationId);
                    item.Node = queue.AddLast(item);
                    if (!_running && !_pumpPosted)
                    {
                        _pumpPosted = true;
                        shouldPost = true;
                    }
                }
            }
        }

        if (rejection != null)
            return Task.FromResult(rejection);

        item!.RegisterCancellation(() => CancelBeforeStart(item));
        NotifyStatusChanged();
        if (shouldPost)
            PostPump();
        return item.Completion;
    }

    private bool IsExpired(DateTimeOffset? deadline)
    {
        return deadline.HasValue && _clock.UtcNow >= deadline.Value;
    }

    private void CancelBeforeStart(WorkItem item)
    {
        var cancelled = false;
        lock (_gate)
        {
            if (!item.Started && item.Node?.List != null)
            {
                item.Node.List.Remove(item.Node);
                item.Node = null;
                cancelled = true;
            }
        }

        if (cancelled)
        {
            item.CompleteBeforeStart(DispatcherResultKind.CancelledBeforeStart);
            NotifyStatusChanged();
        }
    }

    private void PumpOne()
    {
        WorkItem? item;
        DispatcherResultKind? rejection = null;

        lock (_gate)
        {
            _pumpPosted = false;
            item = TakeNext();
            if (item != null)
            {
                if (item.CancellationToken.IsCancellationRequested)
                    rejection = DispatcherResultKind.CancelledBeforeStart;
                else if (IsExpired(item.StartDeadlineAt))
                    rejection = DispatcherResultKind.DeadlineExceededBeforeStart;
                else
                {
                    item.Started = _running = true;
                    _runningItem = item;
                }
            }
        }

        if (item == null)
        {
            PostNextIfNeeded();
            return;
        }

        NotifyStatusChanged();
        item.DisposeCancellationRegistration();
        if (rejection.HasValue)
        {
            item.CompleteBeforeStart(rejection.Value);
            PostNextIfNeeded();
            return;
        }

        item.Execute();
        lock (_gate)
        {
            _running = false;
            _runningItem = null;
        }
        NotifyStatusChanged();
        PostNextIfNeeded();
    }

    private WorkItem? TakeNext()
    {
        var queue = _lifecycleQueue.Count > 0 ? _lifecycleQueue : _externalQueue;
        if (queue.First == null)
            return null;

        var item = queue.First.Value;
        queue.RemoveFirst();
        item.Node = null;
        return item;
    }

    private void PostNextIfNeeded()
    {
        var shouldPost = false;
        lock (_gate)
        {
            if (!_running && !_pumpPosted && (_lifecycleQueue.Count > 0 || _externalQueue.Count > 0))
            {
                _pumpPosted = true;
                shouldPost = true;
            }
        }

        if (shouldPost)
            PostPump();
    }

    private void PostPump()
    {
        try
        {
            _scheduler.Post(PumpOne);
        }
        catch (Exception exception)
        {
            List<WorkItem> failed;
            lock (_gate)
            {
                _pumpPosted = false;
                _shutdown = true;
                _acceptingExternalWork = false;
                failed = DrainQueue(_lifecycleQueue);
                failed.AddRange(DrainQueue(_externalQueue));
            }

            foreach (var item in failed)
                item.Fail(exception);
            NotifyStatusChanged();
        }
    }

    private void NotifyStatusChanged() => StatusChanged?.Invoke(Status);

    private static List<WorkItem> DrainQueue(LinkedList<WorkItem> queue)
    {
        var items = new List<WorkItem>(queue.Count);
        while (queue.First != null)
        {
            var item = queue.First.Value;
            queue.RemoveFirst();
            item.Node = null;
            items.Add(item);
        }
        return items;
    }

    private abstract class WorkItem
    {
        private readonly object _registrationGate = new();
        private CancellationTokenRegistration _registration;
        private bool _registrationAssigned;
        private bool _registrationDisposed;

        protected WorkItem(
            DateTimeOffset? startDeadlineAt,
            CancellationToken cancellationToken,
            string? operationId)
        {
            StartDeadlineAt = startDeadlineAt;
            CancellationToken = cancellationToken;
            OperationId = operationId;
        }

        public DateTimeOffset? StartDeadlineAt { get; }
        public CancellationToken CancellationToken { get; }
        public string? OperationId { get; }
        public LinkedListNode<WorkItem>? Node { get; set; }
        public bool Started { get; set; }

        public void RegisterCancellation(Action cancel)
        {
            if (!CancellationToken.CanBeCanceled)
                return;

            var registration = CancellationToken.Register(cancel);
            var disposeNow = false;
            lock (_registrationGate)
            {
                if (_registrationDisposed)
                    disposeNow = true;
                else
                {
                    _registration = registration;
                    _registrationAssigned = true;
                }
            }

            if (disposeNow)
                registration.Dispose();
        }

        public void DisposeCancellationRegistration()
        {
            CancellationTokenRegistration registration = default;
            var hasRegistration = false;
            lock (_registrationGate)
            {
                if (_registrationDisposed)
                    return;

                _registrationDisposed = true;
                if (_registrationAssigned)
                {
                    registration = _registration;
                    hasRegistration = true;
                }
            }

            if (hasRegistration)
                registration.Dispose();
        }

        public abstract void Execute();
        public abstract void CompleteBeforeStart(DispatcherResultKind kind);
        public abstract void Fail(Exception exception);
    }

    private sealed class WorkItem<T> : WorkItem
    {
        private readonly Func<T> _operation;
        private readonly TaskCompletionSource<DispatcherResult<T>> _completion =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public WorkItem(
            Func<T> operation,
            DateTimeOffset? startDeadlineAt,
            CancellationToken cancellationToken,
            string? operationId)
            : base(startDeadlineAt, cancellationToken, operationId)
        {
            _operation = operation;
        }

        public Task<DispatcherResult<T>> Completion => _completion.Task;

        public override void Execute()
        {
            try
            {
                _completion.TrySetResult(DispatcherResult<T>.Completed(_operation()));
            }
            catch (Exception exception)
            {
                _completion.TrySetResult(DispatcherResult<T>.Failed(exception));
            }
        }

        public override void CompleteBeforeStart(DispatcherResultKind kind)
        {
            DisposeCancellationRegistration();
            var result = kind switch
            {
                DispatcherResultKind.DeadlineExceededBeforeStart =>
                    DispatcherResult<T>.DeadlineExceededBeforeStart(),
                DispatcherResultKind.CancelledBeforeStart =>
                    DispatcherResult<T>.CancelledBeforeStart(),
                DispatcherResultKind.ShuttingDown =>
                    DispatcherResult<T>.ShuttingDown(),
                _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
            };
            _completion.TrySetResult(result);
        }

        public override void Fail(Exception exception)
        {
            DisposeCancellationRegistration();
            _completion.TrySetResult(DispatcherResult<T>.Failed(exception));
        }
    }
}
