using Hopper.Core.Grasshopper;
using Hopper.Core.Runtime;
using Hopper.Core.Time;

namespace Hopper.Core.Operations;

/// <summary>
/// Process-wide rendezvous used by independently loaded Rhino and Grasshopper
/// assemblies. Each contained registry still enforces same-instance compare-and-set.
/// </summary>
public static class HostOperationRegistries
{
    public static RhinoOperationRegistry Rhino { get; } = new();

    public static GrasshopperCapabilityRegistry Grasshopper { get; } =
        new(SystemHopperClock.Instance, installed: false);

    public static HostDocumentStatusRegistry DocumentStatus { get; } = new();
}
