using System;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class ComponentPropertyOps
    {
        public static string RenameComponent(GH_Document doc, RenameComponentParams param)
        {
            if (doc == null)
                return "renameComponent error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"renameComponent error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"renameComponent error: object not found '{param.TargetId}'";

            obj.NickName = param.NickName;
            doc.NewSolution(true);

            return $"renameComponent: renamed ({param.TargetId}) to '{param.NickName}'";
        }

        public static string SetComponentLocked(GH_Document doc, SetComponentLockedParams param)
        {
            if (doc == null)
                return "setComponentLocked error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setComponentLocked error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setComponentLocked error: object not found '{param.TargetId}'";

            if (obj is GH_ActiveObject activeObj)
                activeObj.Locked = param.Locked;
            else
                return $"setComponentLocked error: object '{param.TargetId}' does not support locking";

            return $"setComponentLocked: set ({param.TargetId}) locked={param.Locked}";
        }

        public static string SetComponentHidden(GH_Document doc, SetComponentHiddenParams param)
        {
            if (doc == null)
                return "setComponentHidden error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setComponentHidden error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setComponentHidden error: object not found '{param.TargetId}'";

            var hiddenProp = obj.GetType().GetProperty("Hidden");
            if (hiddenProp != null)
            {
                hiddenProp.SetValue(obj, param.Hidden);
                obj.OnDisplayExpired(true);

                if (obj is GH_ActiveObject activeObj)
                    activeObj.ExpireSolution(true);
            }
            else
            {
                return $"setComponentHidden error: object '{param.TargetId}' does not support hiding";
            }

            return $"setComponentHidden: set ({param.TargetId}) hidden={param.Hidden}";
        }
    }
}
