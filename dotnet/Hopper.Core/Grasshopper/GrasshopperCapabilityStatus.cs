namespace Hopper.Core.Grasshopper;

public sealed record GrasshopperCapabilityError(string Code, string Message);

public sealed record GrasshopperCapabilityStatus(
    long Revision,
    DateTimeOffset ChangedAt,
    GrasshopperCapabilityState State,
    GrasshopperCapabilityError? Error)
{
    public string StateName => State.ToProtocolValue();
}
