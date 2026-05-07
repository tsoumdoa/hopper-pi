using System;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc
{
    public static class GroupOperations
    {
        public static string AddGroup(GH_Document doc, AddGroupParams param)
        {
            if (doc == null)
                return "addGroup error: document is null";

            var group = new GH_Group();
            group.NickName = param.GroupName;

            int addedCount = 0;
            foreach (var idStr in param.ComponentIds)
            {
                if (Guid.TryParse(idStr, out var guid))
                {
                    var obj = doc.FindObject(guid, false);
                    if (obj != null)
                    {
                        group.AddObject(obj.InstanceGuid);
                        addedCount++;
                    }
                }
            }

            doc.AddObject(group, false);

            return $"addGroup: created group '{param.GroupName}' with {addedCount} objects";
        }

        public static string RemoveFromGroup(GH_Document doc, RemoveFromGroupParams param)
        {
            if (doc == null)
                return "removeFromGroup error: document is null";

            GH_Group targetGroup = null;
            foreach (var obj in doc.Objects)
            {
                if (obj is GH_Group g && string.Equals(g.NickName, param.GroupName, StringComparison.OrdinalIgnoreCase))
                {
                    targetGroup = g;
                    break;
                }
            }

            if (targetGroup == null)
                return $"removeFromGroup error: group '{param.GroupName}' not found";

            int removedCount = 0;
            foreach (var idStr in param.ComponentIds)
            {
                if (Guid.TryParse(idStr, out var guid))
                {
                    bool contains = targetGroup.Objects().Any(o => o.InstanceGuid == guid);
                    if (contains)
                    {
                        targetGroup.RemoveObject(guid);
                        removedCount++;
                    }
                }
            }

            return $"removeFromGroup: removed {removedCount} objects from group '{param.GroupName}'";
        }
    }
}
