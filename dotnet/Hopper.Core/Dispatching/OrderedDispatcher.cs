using Hopper.Core.Time;

namespace Hopper.Core.Dispatching;

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
        CancellationToken cancellationToken = default)
    {
        return Submit(operation, startDeadlineAt, cancellationToken, lifecycleControl: false);
    }

    public Task<DispatcherResult<T>> SubmitLifecycleControl<T>(
        Func<T> operation,
        DateTimeOffset? startDeadlineAt = null,
        CancellationToken cancellationToken = default)
    {
        return Submit(operation, startDeadlineAt, cancellationToken, lifecycleControl: true);
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
        lock (_gate)
            _acceptingExternalWork = false;
    }

    public bool ReopenExternalAdmission()
    {
        lock (_gate)
        {
            if (_shutdown)
                return false;

            _acceptingExternalWork = true;
            return true;
        }
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
        return cancelled.Count;
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
    }

    private Task<DispatcherResult<T>> Submit<T>(
        Func<T> operation,
        DateTimeOffset? startDeadlineAt,
        CancellationToken cancellationToken,
        bool lifecycleControl)
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
                    item = new WorkItem<T>(operation, startDeadlineAt, cancellationToken);
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
            item.CompleteBeforeStart(DispatcherResultKind.CancelledBeforeStart);
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
                    item.Started = _running = true;
            }
        }

        if (item == null)
        {
            PostNextIfNeeded();
            return;
        }

        item.DisposeCancellationRegistration();
        if (rejection.HasValue)
        {
            item.CompleteBeforeStart(rejection.Value);
            PostNextIfNeeded();
            return;
        }

        item.Execute();
        lock (_gate)
            _running = false;
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
        }
    }

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

        protected WorkItem(DateTimeOffset? startDeadlineAt, CancellationToken cancellationToken)
        {
            StartDeadlineAt = startDeadlineAt;
            CancellationToken = cancellationToken;
        }

        public DateTimeOffset? StartDeadlineAt { get; }
        public CancellationToken CancellationToken { get; }
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
            CancellationToken cancellationToken)
            : base(startDeadlineAt, cancellationToken)
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
