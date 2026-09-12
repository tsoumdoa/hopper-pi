namespace Hopper.Core.Lifecycle;

public sealed record LifecycleSnapshot(
    long Revision,
    DateTimeOffset ChangedAt,
    LifecycleState State,
    LifecycleReasonCode Reason,
    string Message,
    string? LifecycleInstanceId,
    int ConsecutiveHealthFailures);

public sealed record LifecycleCommandResult(
    bool Accepted,
    string Message,
    LifecycleSnapshot Snapshot);
