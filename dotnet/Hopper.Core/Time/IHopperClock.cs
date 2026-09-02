namespace Hopper.Core.Time;

public interface IHopperClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemHopperClock : IHopperClock
{
    public static SystemHopperClock Instance { get; } = new();

    private SystemHopperClock()
    {
    }

    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
