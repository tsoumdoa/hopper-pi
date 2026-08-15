using System;
using System.Collections.Generic;
using System.Text.Json;
using rhino_zmq_poc.Protocol;

namespace rhino_zmq_poc
{
    internal enum LedgerDecision
    {
        Accepted,
        Existing,
        Conflict,
        Expired,
        Busy,
        NotFound
    }

    internal sealed class RequestLedgerEntry
    {
        public string RequestId { get; }
        public string PayloadSha256 { get; }
        public string State { get; internal set; }
        public DateTimeOffset ExpiresAt { get; }
        public WireResponseDto<JsonElement>? CachedResponse { get; internal set; }

        internal RequestLedgerEntry(string requestId, string payloadSha256, DateTimeOffset expiresAt)
        {
            RequestId = requestId;
            PayloadSha256 = payloadSha256;
            State = "running";
            ExpiresAt = expiresAt;
        }
    }

    internal sealed class LedgerResult
    {
        public LedgerDecision Decision { get; }
        public RequestLedgerEntry Entry { get; }

        public LedgerResult(LedgerDecision decision, RequestLedgerEntry entry = null)
        {
            Decision = decision;
            Entry = entry;
        }
    }

    internal sealed class RequestLedger
    {
        public static readonly TimeSpan DefaultWindow = TimeSpan.FromHours(24);

        private const string UlidAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        private readonly object _sync = new object();
        private readonly Dictionary<string, RequestLedgerEntry> _entries =
            new Dictionary<string, RequestLedgerEntry>(StringComparer.Ordinal);
        private readonly int _capacity;
        private readonly TimeSpan _window;
        private readonly Func<DateTimeOffset> _clock;

        public RequestLedger(
            int capacity,
            TimeSpan? window = null,
            Func<DateTimeOffset> clock = null)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _capacity = capacity;
            _window = window ?? DefaultWindow;
            if (_window <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(window));
            _clock = clock ?? (() => DateTimeOffset.UtcNow);
        }

        public int Count
        {
            get { lock (_sync) return _entries.Count; }
        }

        public LedgerResult TryBegin(string requestId, string payloadSha256)
        {
            if (string.IsNullOrWhiteSpace(payloadSha256))
                return new LedgerResult(LedgerDecision.Conflict);
            lock (_sync)
            {
                var now = _clock();
                CleanupLocked(now);
                if (_entries.TryGetValue(requestId ?? "", out var existing))
                {
                    return string.Equals(existing.PayloadSha256, payloadSha256, StringComparison.Ordinal)
                        ? new LedgerResult(LedgerDecision.Existing, existing)
                        : new LedgerResult(LedgerDecision.Conflict, existing);
                }

                if (!TryGetUlidTimestamp(requestId, out var issuedAt) || issuedAt + _window <= now)
                    return new LedgerResult(LedgerDecision.Expired);
                if (_entries.Count >= _capacity)
                    return new LedgerResult(LedgerDecision.Busy);

                var entry = new RequestLedgerEntry(requestId, payloadSha256, issuedAt + _window);
                _entries.Add(requestId, entry);
                return new LedgerResult(LedgerDecision.Accepted, entry);
            }
        }

        public LedgerResult GetStatus(string requestId, string payloadSha256)
        {
            lock (_sync)
            {
                var now = _clock();
                CleanupLocked(now);
                if (!TryGetUlidTimestamp(requestId, out var issuedAt) || issuedAt + _window <= now)
                    return new LedgerResult(LedgerDecision.Expired);
                if (!_entries.TryGetValue(requestId ?? "", out var entry))
                    return new LedgerResult(LedgerDecision.NotFound);
                return string.Equals(entry.PayloadSha256, payloadSha256, StringComparison.Ordinal)
                    ? new LedgerResult(LedgerDecision.Existing, entry)
                    : new LedgerResult(LedgerDecision.Conflict, entry);
            }
        }

        public bool Complete(
            string requestId,
            string payloadSha256,
            string state,
            WireResponseDto<JsonElement> response)
        {
            if (state != "succeeded" && state != "failed" && state != "partial" && state != "unknown")
                throw new ArgumentException("State must be terminal.", nameof(state));
            lock (_sync)
            {
                if (!_entries.TryGetValue(requestId ?? "", out var entry)) return false;
                if (!string.Equals(entry.PayloadSha256, payloadSha256, StringComparison.Ordinal)) return false;
                entry.State = state;
                entry.CachedResponse = response;
                return true;
            }
        }

        public int Cleanup()
        {
            lock (_sync) return CleanupLocked(_clock());
        }

        private int CleanupLocked(DateTimeOffset now)
        {
            var expired = new List<string>();
            foreach (var pair in _entries)
            {
                if (pair.Value.ExpiresAt <= now) expired.Add(pair.Key);
            }
            foreach (var requestId in expired) _entries.Remove(requestId);
            return expired.Count;
        }

        internal static bool TryGetUlidTimestamp(string requestId, out DateTimeOffset timestamp)
        {
            timestamp = default;
            if (requestId == null || !requestId.StartsWith("req_", StringComparison.Ordinal) || requestId.Length != 30)
                return false;
            var ulid = requestId.Substring(4);
            if (UlidAlphabet.IndexOf(char.ToUpperInvariant(ulid[0])) > 7) return false;
            long milliseconds = 0;
            for (var index = 0; index < 10; index++)
            {
                var value = UlidAlphabet.IndexOf(char.ToUpperInvariant(ulid[index]));
                if (value < 0) return false;
                milliseconds = checked(milliseconds * 32 + value);
            }
            try
            {
                timestamp = DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
                return true;
            }
            catch (ArgumentOutOfRangeException)
            {
                return false;
            }
        }
    }
}
