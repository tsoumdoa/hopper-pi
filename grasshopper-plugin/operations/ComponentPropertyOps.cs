using System;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class ComponentPropertyOps
    {
        public static string RenameComponent(GH_Document doc, RenameComponentParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"renameComponent error: {err}");

            obj.NickName = param.NickName;
            doc.NewSolution(true);

            return $"renameComponent: renamed ({param.TargetId}) to '{param.NickName}'";
        }

        public static string SetComponentLocked(GH_Document doc, SetComponentLockedParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setComponentLocked error: {err}");

            if (obj is GH_ActiveObject activeObj)
                activeObj.Locked = param.Locked;
            else
                return CommandOperationException.Fail($"setComponentLocked error: object '{param.TargetId}' does not support locking");

            return $"setComponentLocked: set ({param.TargetId}) locked={param.Locked}";
        }

        public static string SetComponentHidden(GH_Document doc, SetComponentHiddenParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setComponentHidden error: {err}");

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
                return CommandOperationException.Fail($"setComponentHidden error: object '{param.TargetId}' does not support hiding");
            }

            return $"setComponentHidden: set ({param.TargetId}) hidden={param.Hidden}";
        }
    }
}
