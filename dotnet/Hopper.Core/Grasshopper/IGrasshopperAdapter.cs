namespace Hopper.Core.Grasshopper;

/// <summary>
/// Marker contract implemented by the lazy-loaded Grasshopper assembly. Core stores
/// the adapter by this interface so Rhino-owned code never references Grasshopper types.
/// </summary>
public interface IGrasshopperAdapter
{
}
