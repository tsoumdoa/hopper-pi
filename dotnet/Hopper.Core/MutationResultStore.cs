using System.Text;

namespace Hopper.Core;

public enum OperationRetentionKind
{
    Query,
    Mutation,
}

public enum MutationAdmissionState
{
    Admitted,
    ExistingPending,
    ExistingTerminal,
    Busy,
    QueryNotRetained,
    InvalidOperationId,
}

public enum MutationLookupState
{
    Pending,
    Terminal,
    NotFound,
}

public enum MutationCompletionState
{
    Completed,
    ExistingTerminal,
    NotFound,
    ResultTooLarge,
}

public sealed record MutationResultStoreOptions
{
    public const int DefaultMaximumCount = 256;
    public const long DefaultMaximumBytes = 16L * 1024 * 1024;
    public const int DefaultReservationBytes = 64 * 1024;
    public const int DefaultMaximumTerminalResultBytes = 64 * 1024;
    public static readonly TimeSpan DefaultTimeToLive = TimeSpan.FromMinutes(10);

    public int MaximumCount { get; init; } = DefaultMaximumCount;
    public long MaximumBytes { get; init; } = DefaultMaximumBytes;
    public int ReservationBytes { get; init; } = DefaultReservationBytes;
    public int MaximumTerminalResultBytes { get; init; } = DefaultMaximumTerminalResultBytes;
    public TimeSpan TimeToLive { get; init; } = DefaultTimeToLive;

    internal void Validate()
    {
        if (MaximumCount <= 0)
            throw new ArgumentOutOfRangeException(nameof(MaximumCount));
        if (MaximumBytes <= 0)
            throw new ArgumentOutOfRangeException(nameof(MaximumBytes));
        if (ReservationBytes <= 0 || ReservationBytes > MaximumBytes)
            throw new ArgumentOutOfRangeException(nameof(ReservationBytes));
        if (MaximumTerminalResultBytes <= 0 || MaximumTerminalResultBytes > ReservationBytes)
            throw new ArgumentOutOfRangeException(nameof(MaximumTerminalResultBytes));
        if (TimeToLive <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(TimeToLive));
    }
}

public interface IMutationResultStoreClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemMutationResultStoreClock : IMutationResultStoreClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public sealed record SerializedMutationResult(string Body);

public sealed record OperationResultTooLargeTerminal(string Body);

public interface IMutationResultSerializer<in TResult>
{
    SerializedMutationResult Serialize(TResult result);
}

public sealed record RetainedMutationResult(
    string Body,
    int ByteCount,
    DateTimeOffset CompletedAt,
    DateTimeOffset ExpiresAt);

public sealed record MutationResultStoreSnapshot(
    int InFlightCount,
    int TerminalCount,
    long UsedBytes,
    int MaximumCount,
    long MaximumBytes)
{
    public int TotalCount => InFlightCount + TerminalCount;
}

public sealed record MutationAdmissionResult(
    MutationAdmissionState State,
    RetainedMutationResult? TerminalResult,
    MutationResultStoreSnapshot Snapshot);

public sealed record MutationLookupResult(
    MutationLookupState State,
    RetainedMutationResult? TerminalResult);

public sealed record MutationCompletionResult(
    MutationCompletionState State,
    RetainedMutationResult? TerminalResult,
    MutationResultStoreSnapshot Snapshot);

public sealed class MutationResultStore<TResult>
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly IMutationResultStoreClock _clock;
    private readonly IMutationResultSerializer<TResult> _serializer;
    private readonly OperationResultTooLargeTerminal _operationResultTooLargeTerminal;
    private readonly int _operationResultTooLargeTerminalBytes;
    private readonly MutationResultStoreOptions _options;
    private long _usedBytes;

    public MutationResultStore(
        IMutationResultStoreClock clock,
        IMutationResultSerializer<TResult> serializer,
        OperationResultTooLargeTerminal operationResultTooLargeTerminal,
        MutationResultStoreOptions? options = null)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _serializer = serializer ?? throw new ArgumentNullException(nameof(serializer));
        _operationResultTooLargeTerminal = operationResultTooLargeTerminal
            ?? throw new ArgumentNullException(nameof(operationResultTooLargeTerminal));
        _options = options ?? new MutationResultStoreOptions();
        _options.Validate();
        if (string.IsNullOrWhiteSpace(_operationResultTooLargeTerminal.Body))
        {
            throw new ArgumentException(
                "OPERATION_RESULT_TOO_LARGE terminal body cannot be empty.",
                nameof(operationResultTooLargeTerminal));
        }
        _operationResultTooLargeTerminalBytes = Encoding.UTF8.GetByteCount(_operationResultTooLargeTerminal.Body);
        if (_operationResultTooLargeTerminalBytes > _options.MaximumTerminalResultBytes)
        {
            throw new ArgumentException(
                "OPERATION_RESULT_TOO_LARGE terminal body exceeds the terminal result byte limit.",
                nameof(operationResultTooLargeTerminal));
        }
    }

    public MutationAdmissionResult Admit(OperationRetentionKind kind, string? operationId = null)
    {
        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            if (kind == OperationRetentionKind.Query)
            {
                return new MutationAdmissionResult(
                    MutationAdmissionState.QueryNotRetained,
                    null,
                    SnapshotLocked());
            }
            if (string.IsNullOrWhiteSpace(operationId))
            {
                return new MutationAdmissionResult(
                    MutationAdmissionState.InvalidOperationId,
                    null,
                    SnapshotLocked());
            }

            if (_entries.TryGetValue(operationId, out var existing))
            {
                return existing.TerminalResult is null
                    ? new MutationAdmissionResult(
                        MutationAdmissionState.ExistingPending,
                        null,
                        SnapshotLocked())
                    : new MutationAdmissionResult(
                        MutationAdmissionState.ExistingTerminal,
                        existing.TerminalResult,
                        SnapshotLocked());
            }

            if (_entries.Count >= _options.MaximumCount
                || _usedBytes + _options.ReservationBytes > _options.MaximumBytes)
            {
                return new MutationAdmissionResult(
                    MutationAdmissionState.Busy,
                    null,
                    SnapshotLocked());
            }

            _entries.Add(operationId, Entry.Pending());
            _usedBytes += _options.ReservationBytes;
            return new MutationAdmissionResult(
                MutationAdmissionState.Admitted,
                null,
                SnapshotLocked());
        }
    }

    public MutationLookupResult Lookup(string operationId)
    {
        RequireOperationId(operationId);
        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            if (!_entries.TryGetValue(operationId, out var entry))
                return new MutationLookupResult(MutationLookupState.NotFound, null);
            return entry.TerminalResult is null
                ? new MutationLookupResult(MutationLookupState.Pending, null)
                : new MutationLookupResult(MutationLookupState.Terminal, entry.TerminalResult);
        }
    }

    /// <summary>
    /// Converts an in-flight reservation to a retained terminal body. If the serialized body
    /// exceeds the byte limit, the store retains the injected OPERATION_RESULT_TOO_LARGE body
    /// instead, so the operation never remains pending because its result was too large.
    /// </summary>
    public MutationCompletionResult Complete(string operationId, TResult result)
    {
        RequireOperationId(operationId);

        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            if (!_entries.TryGetValue(operationId, out var current))
            {
                return new MutationCompletionResult(
                    MutationCompletionState.NotFound,
                    null,
                    SnapshotLocked());
            }
            if (current.TerminalResult is not null)
            {
                return new MutationCompletionResult(
                    MutationCompletionState.ExistingTerminal,
                    current.TerminalResult,
                    SnapshotLocked());
            }
        }

        var serialized = _serializer.Serialize(result)
            ?? throw new InvalidOperationException("Mutation result serializer returned null.");
        if (serialized.Body is null)
            throw new InvalidOperationException("Mutation result serializer returned a null body.");
        var serializedBytes = Encoding.UTF8.GetByteCount(serialized.Body);
        var completionState = serializedBytes > _options.MaximumTerminalResultBytes
            ? MutationCompletionState.ResultTooLarge
            : MutationCompletionState.Completed;
        if (completionState == MutationCompletionState.ResultTooLarge)
        {
            serialized = new SerializedMutationResult(_operationResultTooLargeTerminal.Body);
            serializedBytes = _operationResultTooLargeTerminalBytes;
        }

        lock (_gate)
        {
            var now = _clock.UtcNow;
            RemoveExpiredLocked(now);
            if (!_entries.TryGetValue(operationId, out var current))
            {
                return new MutationCompletionResult(
                    MutationCompletionState.NotFound,
                    null,
                    SnapshotLocked());
            }
            if (current.TerminalResult is not null)
            {
                return new MutationCompletionResult(
                    MutationCompletionState.ExistingTerminal,
                    current.TerminalResult,
                    SnapshotLocked());
            }

            var terminal = new RetainedMutationResult(
                serialized.Body,
                serializedBytes,
                now,
                now.Add(_options.TimeToLive));
            current.TerminalResult = terminal;
            _usedBytes -= _options.ReservationBytes - serializedBytes;
            return new MutationCompletionResult(
                completionState,
                terminal,
                SnapshotLocked());
        }
    }

    public bool ReleaseInFlight(string operationId)
    {
        RequireOperationId(operationId);
        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            if (!_entries.TryGetValue(operationId, out var entry) || entry.TerminalResult is not null)
                return false;
            _entries.Remove(operationId);
            _usedBytes -= _options.ReservationBytes;
            return true;
        }
    }

    public int ReleaseAllInFlight()
    {
        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            var pendingIds = _entries
                .Where(pair => pair.Value.TerminalResult is null)
                .Select(pair => pair.Key)
                .ToArray();
            foreach (var operationId in pendingIds)
                _entries.Remove(operationId);
            _usedBytes -= (long)pendingIds.Length * _options.ReservationBytes;
            return pendingIds.Length;
        }
    }

    public int RemoveExpired()
    {
        lock (_gate)
            return RemoveExpiredLocked(_clock.UtcNow);
    }

    public MutationResultStoreSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            RemoveExpiredLocked(_clock.UtcNow);
            return SnapshotLocked();
        }
    }

    private int RemoveExpiredLocked(DateTimeOffset now)
    {
        var expiredIds = _entries
            .Where(pair => pair.Value.TerminalResult is { } terminal && terminal.ExpiresAt <= now)
            .Select(pair => pair.Key)
            .ToArray();
        foreach (var operationId in expiredIds)
        {
            _usedBytes -= _entries[operationId].TerminalResult!.ByteCount;
            _entries.Remove(operationId);
        }
        return expiredIds.Length;
    }

    private MutationResultStoreSnapshot SnapshotLocked()
    {
        var terminalCount = _entries.Count(pair => pair.Value.TerminalResult is not null);
        return new MutationResultStoreSnapshot(
            _entries.Count - terminalCount,
            terminalCount,
            _usedBytes,
            _options.MaximumCount,
            _options.MaximumBytes);
    }

    private static void RequireOperationId(string operationId)
    {
        if (string.IsNullOrWhiteSpace(operationId))
            throw new ArgumentException("Operation ID must be non-empty.", nameof(operationId));
    }

    private sealed class Entry
    {
        private Entry()
        {
        }

        public RetainedMutationResult? TerminalResult { get; set; }

        public static Entry Pending() => new();
    }
}
