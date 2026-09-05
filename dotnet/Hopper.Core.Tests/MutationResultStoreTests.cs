using Hopper.Core;
using Xunit;

namespace Hopper.Core.Tests;

public class MutationResultStoreTests
{
    [Fact]
    public void DefaultLimitsMatchProtocolPolicy()
    {
        var options = new MutationResultStoreOptions();

        Assert.Equal(256, options.MaximumCount);
        Assert.Equal(16L * 1024 * 1024, options.MaximumBytes);
        Assert.Equal(64 * 1024, options.ReservationBytes);
        Assert.Equal(64 * 1024, options.MaximumTerminalResultBytes);
        Assert.Equal(TimeSpan.FromMinutes(10), options.TimeToLive);
    }

    [Fact]
    public void QueriesCannotBeAdmittedOrRetained()
    {
        var fixture = Fixture();

        var admission = fixture.Store.Admit(OperationRetentionKind.Query, "query-id");

        Assert.Equal(MutationAdmissionState.QueryNotRetained, admission.State);
        Assert.Equal(0, admission.Snapshot.TotalCount);
        Assert.Equal(MutationLookupState.NotFound, fixture.Store.Lookup("query-id").State);
        Assert.Equal(MutationCompletionState.NotFound, fixture.Store.Complete("query-id", Result("query")).State);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void MutationAdmissionRequiresOperationId(string? operationId)
    {
        var fixture = Fixture();

        var result = fixture.Store.Admit(OperationRetentionKind.Mutation, operationId);

        Assert.Equal(MutationAdmissionState.InvalidOperationId, result.State);
        Assert.Equal(0, result.Snapshot.TotalCount);
    }

    [Fact]
    public void DefaultCountAndByteBoundariesAllowExactly256Reservations()
    {
        var fixture = Fixture();

        for (var index = 0; index < 256; index++)
        {
            Assert.Equal(
                MutationAdmissionState.Admitted,
                fixture.Store.Admit(OperationRetentionKind.Mutation, $"operation-{index}").State);
        }

        var snapshot = fixture.Store.GetSnapshot();
        Assert.Equal(256, snapshot.InFlightCount);
        Assert.Equal(16L * 1024 * 1024, snapshot.UsedBytes);
        Assert.Equal(
            MutationAdmissionState.Busy,
            fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-overflow").State);
    }

    [Fact]
    public void ConfiguredByteLimitCanBindBeforeCountLimit()
    {
        var fixture = Fixture(new MutationResultStoreOptions
        {
            MaximumCount = 10,
            MaximumBytes = 200,
            ReservationBytes = 100,
            MaximumTerminalResultBytes = 100,
        });

        Assert.Equal(MutationAdmissionState.Admitted, fixture.Store.Admit(OperationRetentionKind.Mutation, "one").State);
        Assert.Equal(MutationAdmissionState.Admitted, fixture.Store.Admit(OperationRetentionKind.Mutation, "two").State);
        Assert.Equal(MutationAdmissionState.Busy, fixture.Store.Admit(OperationRetentionKind.Mutation, "three").State);
    }

    [Fact]
    public void AdmissionReservesFullResultSlotAndDuplicateDoesNotReserveAgain()
    {
        var fixture = Fixture();
        var first = fixture.Store.Admit(OperationRetentionKind.Mutation, "same");

        Assert.Equal(MutationAdmissionState.Admitted, first.State);
        Assert.Equal(1, first.Snapshot.InFlightCount);
        Assert.Equal(MutationResultStoreOptions.DefaultReservationBytes, first.Snapshot.UsedBytes);
        Assert.Equal(MutationLookupState.Pending, fixture.Store.Lookup("same").State);

        var duplicate = fixture.Store.Admit(OperationRetentionKind.Mutation, "same");

        Assert.Equal(MutationAdmissionState.ExistingPending, duplicate.State);
        Assert.Equal(1, duplicate.Snapshot.TotalCount);
        Assert.Equal(MutationResultStoreOptions.DefaultReservationBytes, duplicate.Snapshot.UsedBytes);
    }

    [Fact]
    public void CompletionConvertsReservationToActualSerializedBytes()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");

        var completion = fixture.Store.Complete("operation-1", Result("done"));

        Assert.Equal(MutationCompletionState.Completed, completion.State);
        Assert.Equal(0, completion.Snapshot.InFlightCount);
        Assert.Equal(1, completion.Snapshot.TerminalCount);
        Assert.Equal(4, completion.Snapshot.UsedBytes);
        Assert.Equal("done", completion.TerminalResult!.Body);
        Assert.Equal(4, completion.TerminalResult.ByteCount);
    }

    [Fact]
    public void DuplicateTerminalAdmissionReturnsStoredResultWithoutExecutingAgain()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "same");
        var first = fixture.Store.Complete("same", Result("first"));

        var duplicate = fixture.Store.Admit(OperationRetentionKind.Mutation, "same");
        var secondCompletion = fixture.Store.Complete("same", Result("replacement"));

        Assert.Equal(MutationAdmissionState.ExistingTerminal, duplicate.State);
        Assert.Equal(first.TerminalResult, duplicate.TerminalResult);
        Assert.Equal(MutationCompletionState.ExistingTerminal, secondCompletion.State);
        Assert.Equal("first", secondCompletion.TerminalResult!.Body);
        Assert.Equal(5, secondCompletion.Snapshot.UsedBytes);
    }

    [Fact]
    public void LookupReturnsPendingTerminalAndNotFoundStates()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");

        Assert.Equal(MutationLookupState.Pending, fixture.Store.Lookup("operation-1").State);
        fixture.Store.Complete("operation-1", Result("terminal"));
        var terminal = fixture.Store.Lookup("operation-1");
        Assert.Equal(MutationLookupState.Terminal, terminal.State);
        Assert.Equal("terminal", terminal.TerminalResult!.Body);
        Assert.Equal(MutationLookupState.NotFound, fixture.Store.Lookup("missing").State);
    }

    [Fact]
    public void AcceptsSerializedTerminalResultAtExactByteBoundary()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");
        var body = new string('a', 65_536);

        var completion = fixture.Store.Complete("operation-1", Result(body));

        Assert.Equal(MutationCompletionState.Completed, completion.State);
        Assert.Equal(MutationLookupState.Terminal, fixture.Store.Lookup("operation-1").State);
        Assert.Equal(65_536, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public void OversizedResultBecomesCompactRetainedTerminalFailure()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");

        var completion = fixture.Store.Complete("operation-1", Result(new string('a', 65_537)));

        Assert.Equal(MutationCompletionState.ResultTooLarge, completion.State);
        Assert.Equal(OversizedTerminalBody, completion.TerminalResult!.Body);
        Assert.Equal(MutationLookupState.Terminal, fixture.Store.Lookup("operation-1").State);
        Assert.Equal(OversizedTerminalBody.Length, fixture.Store.GetSnapshot().UsedBytes);
        Assert.Equal(
            MutationAdmissionState.ExistingTerminal,
            fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1").State);
    }

    [Fact]
    public void ByteLimitUsesUtf8SizeRatherThanCharacterCount()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "exact");
        fixture.Store.Admit(OperationRetentionKind.Mutation, "over");
        var exact = new string('a', 65_532) + "😀";
        var over = new string('a', 65_533) + "😀";

        Assert.Equal(65_534, exact.Length);
        Assert.Equal(MutationCompletionState.Completed, fixture.Store.Complete("exact", Result(exact)).State);
        Assert.Equal(65_536, fixture.Store.Lookup("exact").TerminalResult!.ByteCount);
        Assert.Equal(MutationCompletionState.ResultTooLarge, fixture.Store.Complete("over", Result(over)).State);
        Assert.Equal(OversizedTerminalBody, fixture.Store.Lookup("over").TerminalResult!.Body);
    }

    [Fact]
    public void SerializerFailureLeavesOperationPending()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");
        fixture.Serializer.Exception = new InvalidOperationException("serialization failed");

        Assert.Throws<InvalidOperationException>(() => fixture.Store.Complete("operation-1", Result("unused")));
        Assert.Equal(MutationLookupState.Pending, fixture.Store.Lookup("operation-1").State);
    }

    [Fact]
    public void TerminalResultExpiresTenMinutesFromCompletion()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "operation-1");
        fixture.Clock.Advance(TimeSpan.FromHours(2));
        var completion = fixture.Store.Complete("operation-1", Result("done"));
        Assert.Equal(fixture.Clock.UtcNow, completion.TerminalResult!.CompletedAt);

        fixture.Clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromTicks(1));
        Assert.Equal(MutationLookupState.Terminal, fixture.Store.Lookup("operation-1").State);
        fixture.Clock.Advance(TimeSpan.FromTicks(1));
        Assert.Equal(MutationLookupState.NotFound, fixture.Store.Lookup("operation-1").State);
        Assert.Equal(0, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public void AdmissionPurgesExpiredResultsBeforeCapacityCheck()
    {
        var fixture = Fixture(new MutationResultStoreOptions
        {
            MaximumCount = 1,
            MaximumBytes = 100,
            ReservationBytes = 100,
            MaximumTerminalResultBytes = 100,
            TimeToLive = TimeSpan.FromMinutes(10),
        });
        fixture.Store.Admit(OperationRetentionKind.Mutation, "old");
        fixture.Store.Complete("old", Result(new string('o', 100)));
        Assert.Equal(MutationAdmissionState.Busy, fixture.Store.Admit(OperationRetentionKind.Mutation, "early").State);

        fixture.Clock.Advance(TimeSpan.FromMinutes(10));
        var admitted = fixture.Store.Admit(OperationRetentionKind.Mutation, "new");

        Assert.Equal(MutationAdmissionState.Admitted, admitted.State);
        Assert.Equal(1, admitted.Snapshot.InFlightCount);
        Assert.Equal(100, admitted.Snapshot.UsedBytes);
    }

    [Fact]
    public void InFlightReservationsNeverExpire()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "pending");

        fixture.Clock.Advance(TimeSpan.FromDays(30));

        Assert.Equal(0, fixture.Store.RemoveExpired());
        Assert.Equal(MutationLookupState.Pending, fixture.Store.Lookup("pending").State);
        Assert.Equal(65_536, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public void CleanupReleasesOnlyInFlightReservationsAndRejectsLateCompletion()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "terminal");
        fixture.Store.Complete("terminal", Result("done"));
        fixture.Store.Admit(OperationRetentionKind.Mutation, "pending-1");
        fixture.Store.Admit(OperationRetentionKind.Mutation, "pending-2");

        Assert.True(fixture.Store.ReleaseInFlight("pending-1"));
        Assert.False(fixture.Store.ReleaseInFlight("terminal"));
        Assert.Equal(1, fixture.Store.ReleaseAllInFlight());

        var snapshot = fixture.Store.GetSnapshot();
        Assert.Equal(0, snapshot.InFlightCount);
        Assert.Equal(1, snapshot.TerminalCount);
        Assert.Equal(4, snapshot.UsedBytes);
        Assert.Equal(MutationLookupState.NotFound, fixture.Store.Lookup("pending-1").State);
        Assert.Equal(MutationLookupState.NotFound, fixture.Store.Lookup("pending-2").State);
        Assert.Equal(
            MutationCompletionState.NotFound,
            fixture.Store.Complete("pending-1", Result("late")).State);
    }

    [Fact]
    public void ConcurrentDuplicateAdmissionsCreateOneReservation()
    {
        var fixture = Fixture();
        var states = new MutationAdmissionState[64];

        Parallel.For(0, states.Length, index =>
        {
            states[index] = fixture.Store.Admit(OperationRetentionKind.Mutation, "same").State;
        });

        Assert.Equal(1, states.Count(state => state == MutationAdmissionState.Admitted));
        Assert.Equal(63, states.Count(state => state == MutationAdmissionState.ExistingPending));
        Assert.Equal(1, fixture.Store.GetSnapshot().InFlightCount);
        Assert.Equal(65_536, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public void ConcurrentCompletionsRetainExactlyOneTerminalResult()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "same");
        var completions = new MutationCompletionResult[32];

        Parallel.For(0, completions.Length, index =>
        {
            completions[index] = fixture.Store.Complete("same", Result($"result-{index}"));
        });

        Assert.Equal(1, completions.Count(result => result.State == MutationCompletionState.Completed));
        Assert.Equal(31, completions.Count(result => result.State == MutationCompletionState.ExistingTerminal));
        var stored = fixture.Store.Lookup("same").TerminalResult!;
        Assert.All(completions, result => Assert.Equal(stored, result.TerminalResult));
        Assert.Equal(stored.ByteCount, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public async Task OversizedCompletionLosingRaceReturnsExistingTerminal()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "same");
        using var oversizedSerializationStarted = new ManualResetEventSlim();
        using var allowOversizedSerialization = new ManualResetEventSlim();
        fixture.Serializer.OnSerialize = result =>
        {
            if (result.Body.Length > 65_536)
            {
                oversizedSerializationStarted.Set();
                allowOversizedSerialization.Wait();
            }
            return new SerializedMutationResult(result.Body);
        };
        var oversizedBody = new string('x', 65_537);
        var oversizedTask = Task.Run(() => fixture.Store.Complete("same", Result(oversizedBody)));
        oversizedSerializationStarted.Wait();

        var winner = fixture.Store.Complete("same", Result("winner"));
        allowOversizedSerialization.Set();
        var loser = await oversizedTask;

        Assert.Equal(MutationCompletionState.Completed, winner.State);
        Assert.Equal(MutationCompletionState.ExistingTerminal, loser.State);
        Assert.Equal(winner.TerminalResult, loser.TerminalResult);
        Assert.Equal("winner", fixture.Store.Lookup("same").TerminalResult!.Body);
    }

    [Fact]
    public async Task CleanupCanWinRaceWhileCompletionSerializesWithoutLeakingReservation()
    {
        var fixture = Fixture();
        fixture.Store.Admit(OperationRetentionKind.Mutation, "racing");
        using var serializerEntered = new ManualResetEventSlim();
        using var allowSerializerToReturn = new ManualResetEventSlim();
        fixture.Serializer.OnSerialize = result =>
        {
            serializerEntered.Set();
            allowSerializerToReturn.Wait();
            return new SerializedMutationResult(result.Body);
        };

        var completionTask = Task.Run(() => fixture.Store.Complete("racing", Result("late")));
        serializerEntered.Wait();
        Assert.True(fixture.Store.ReleaseInFlight("racing"));
        allowSerializerToReturn.Set();
        var completion = await completionTask;

        Assert.Equal(MutationCompletionState.NotFound, completion.State);
        Assert.Equal(0, fixture.Store.GetSnapshot().TotalCount);
        Assert.Equal(0, fixture.Store.GetSnapshot().UsedBytes);
    }

    [Fact]
    public void InvalidOptionsFailBeforeStoreUse()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Fixture(new MutationResultStoreOptions { MaximumCount = 0 }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Fixture(new MutationResultStoreOptions { MaximumBytes = 0 }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Fixture(new MutationResultStoreOptions
        {
            MaximumBytes = 10,
            ReservationBytes = 11,
        }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Fixture(new MutationResultStoreOptions
        {
            ReservationBytes = 10,
            MaximumTerminalResultBytes = 11,
        }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Fixture(new MutationResultStoreOptions { TimeToLive = TimeSpan.Zero }));
    }

    [Fact]
    public void OversizedFallbackMustFitLimitByUtf8ByteCount()
    {
        var options = new MutationResultStoreOptions
        {
            MaximumCount = 1,
            MaximumBytes = 3,
            ReservationBytes = 3,
            MaximumTerminalResultBytes = 3,
        };

        Assert.Throws<ArgumentException>(() => new MutationResultStore<TestResult>(
            new FakeClock(DateTimeOffset.UnixEpoch),
            new FakeSerializer(),
            new OperationResultTooLargeTerminal("😀"),
            options));
    }

    private const string OversizedTerminalBody = "{\"class\":\"failed\",\"reasonCode\":\"OPERATION_RESULT_TOO_LARGE\"}";

    private static TestResult Result(string body) => new(body);

    private static StoreFixture Fixture(MutationResultStoreOptions? options = null)
    {
        var clock = new FakeClock(new DateTimeOffset(2026, 9, 3, 0, 0, 0, TimeSpan.Zero));
        var serializer = new FakeSerializer();
        return new StoreFixture(
            new MutationResultStore<TestResult>(
                clock,
                serializer,
                new OperationResultTooLargeTerminal(OversizedTerminalBody),
                options),
            clock,
            serializer);
    }

    private sealed record StoreFixture(
        MutationResultStore<TestResult> Store,
        FakeClock Clock,
        FakeSerializer Serializer);

    private sealed record TestResult(string Body);

    private sealed class FakeClock(DateTimeOffset now) : IMutationResultStoreClock
    {
        public DateTimeOffset UtcNow { get; private set; } = now;
        public void Advance(TimeSpan duration) => UtcNow += duration;
    }

    private sealed class FakeSerializer : IMutationResultSerializer<TestResult>
    {
        public Exception? Exception { get; set; }
        public Func<TestResult, SerializedMutationResult>? OnSerialize { get; set; }

        public SerializedMutationResult Serialize(TestResult result)
        {
            if (Exception is not null)
                throw Exception;
            return OnSerialize?.Invoke(result) ?? new SerializedMutationResult(result.Body);
        }
    }
}
