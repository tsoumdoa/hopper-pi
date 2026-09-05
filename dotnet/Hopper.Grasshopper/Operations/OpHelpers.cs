using System;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class OpHelpers
    {
        internal static bool TryResolveTarget(GH_Document doc, string targetId, out IGH_DocumentObject obj, out string error)
        {
            obj = null;
            error = null;
            if (doc == null) { error = "document is null"; return false; }
            if (!Guid.TryParse(targetId, out var guid)) { error = $"invalid targetId '{targetId}'"; return false; }
            obj = doc.FindObject(guid, false);
            if (obj == null) { error = $"object not found '{targetId}'"; return false; }
            return true;
        }
    }
}
