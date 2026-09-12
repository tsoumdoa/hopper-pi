namespace Hopper.Core.Runtime;

public static class RuntimeStatusWakeup
{
    public const string Topic = "hopper.status.changed";
}

public sealed record RuntimeStatusWakeupV2
{
    public int ProtocolVersion { get; init; }
    public long Revision { get; init; }
}
