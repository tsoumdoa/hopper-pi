using Hopper.Core.Time;

namespace Hopper.Core.Tests.TestDoubles;

internal sealed class ManualClock : IHopperClock
{
    public ManualClock(DateTimeOffset utcNow)
    {
        UtcNow = utcNow;
    }

    public DateTimeOffset UtcNow { get; private set; }

    public void Advance(TimeSpan duration)
    {
        UtcNow += duration;
    }
}
