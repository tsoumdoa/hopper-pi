using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc
{
    public static class CanvasSelection
    {
        public static List<string> GetSelectedInstanceGuids(GH_Document doc, bool expandGroups = true)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (doc == null) return new List<string>();

            foreach (IGH_DocumentObject obj in doc.Objects)
            {
                if (obj?.Attributes?.Selected != true) continue;
                CollectGuids(obj, result, expandGroups);
            }

            return new List<string>(result);
        }

        private static void CollectGuids(IGH_DocumentObject obj, HashSet<string> result, bool expandGroups)
        {
            if (obj == null) return;

            result.Add(obj.InstanceGuid.ToString());

            if (!expandGroups || !(obj is GH_Group group)) return;

            foreach (var member in group.Objects())
            {
                if (member != null)
                    CollectGuids(member, result, expandGroups);
            }
        }
    }
}
