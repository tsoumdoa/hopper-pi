namespace Hopper.Core.Grasshopper;

public enum GrasshopperCapabilityState
{
    NotInstalled,
    NotLoaded,
    Loading,
    Ready,
    Failed,
}

public static class GrasshopperCapabilityStateExtensions
{
    public static string ToProtocolValue(this GrasshopperCapabilityState state) => state switch
    {
        GrasshopperCapabilityState.NotInstalled => "not_installed",
        GrasshopperCapabilityState.NotLoaded => "not_loaded",
        GrasshopperCapabilityState.Loading => "loading",
        GrasshopperCapabilityState.Ready => "ready",
        GrasshopperCapabilityState.Failed => "failed",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
    };
}
