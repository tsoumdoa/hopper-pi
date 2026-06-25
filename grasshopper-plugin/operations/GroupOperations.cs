using System;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc
{
    internal static class GroupOperations
    {
        public static string AddGroup(GH_Document doc, AddGroupParams param)
        {
            if (doc == null)
                return "addGroup error: document is null";

            var group = new GH_Group();
            group.NickName = param.GroupName;
            group.Colour = Utilities.ParseRgbaColor(param.Color, Color.FromArgb(150, 255, 255, 255));
            if (!string.IsNullOrEmpty(param.Border))
                group.Border = Utilities.ParseGroupBorder(param.Border, group.Border);

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

        private static GH_Group FindGroup(GH_Document doc, string groupName)
        {
            foreach (var obj in doc.Objects)
            {
                if (obj is GH_Group g && string.Equals(g.NickName, groupName, StringComparison.OrdinalIgnoreCase))
                    return g;
            }
            return null;
        }

        public static string DeleteGroup(GH_Document doc, DeleteGroupParams param)
        {
            if (doc == null)
                return "deleteGroup error: document is null";

            var group = FindGroup(doc, param.GroupName);
            if (group == null)
                return $"deleteGroup error: group '{param.GroupName}' not found";

            doc.RemoveObject(group, false);
            return $"deleteGroup: deleted group '{param.GroupName}'";
        }

        public static string ChangeGroupColor(GH_Document doc, ChangeGroupColorParams param)
        {
            if (doc == null)
                return "changeGroupColor error: document is null";

            var group = FindGroup(doc, param.GroupName);
            if (group == null)
                return $"changeGroupColor error: group '{param.GroupName}' not found";

            group.Colour = Utilities.ParseRgbaColor(param.Color, Color.FromArgb(150, 255, 255, 255));
            return $"changeGroupColor: set color of group '{param.GroupName}' to '{param.Color}'";
        }

        public static string RenameGroup(GH_Document doc, RenameGroupParams param)
        {
            if (doc == null)
                return "renameGroup error: document is null";

            var group = FindGroup(doc, param.GroupName);
            if (group == null)
                return $"renameGroup error: group '{param.GroupName}' not found";

            string oldName = group.NickName;
            group.NickName = param.Name;
            return $"renameGroup: renamed group '{oldName}' to '{param.Name}'";
        }

        public static string ChangeGroupStyle(GH_Document doc, ChangeGroupStyleParams param)
        {
            if (doc == null)
                return "changeGroupStyle error: document is null";

            var group = FindGroup(doc, param.GroupName);
            if (group == null)
                return $"changeGroupStyle error: group '{param.GroupName}' not found";

            group.Colour = Utilities.ParseRgbaColor(param.Color, group.Colour);
            if (!string.IsNullOrEmpty(param.Name))
                group.NickName = param.Name;
            if (!string.IsNullOrEmpty(param.Border))
                group.Border = Utilities.ParseGroupBorder(param.Border, group.Border);

            return $"changeGroupStyle: updated style of group '{param.GroupName}'";
        }
    }
}
