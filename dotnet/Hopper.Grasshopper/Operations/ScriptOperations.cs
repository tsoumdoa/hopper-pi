using System;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class ScriptOperations
    {
        public static string CreateScriptNode(GH_Document doc, CreateScriptNodeParams param)
        {
            if (!GraphObjectFactory.TryCreateScript(doc, param, out var created, out var error))
                return $"createScriptNode error: {error}";
            created.ExpireSolution(true);
            return $"createScriptNode: added {param.Language} script ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }

        public static string SetScriptCode(GH_Document doc, SetScriptCodeParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setScriptCode error: {err}";

                var reflector = GhScriptReflector.Get();
                reflector.SetSource(obj, param.Code);

                var comp = obj as GH_Component;
                if (comp != null && (param.Inputs != null || param.Outputs != null))
                {
                    comp.RecordUndoEvent("Sync script params");
                    ComponentLifecycleOps.SyncScriptParams(comp, param.Inputs, param.Outputs);
                }

                obj.ExpireSolution(true);

                return $"setScriptCode: updated code on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"setScriptCode error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string SyncParams(GH_Document doc, SyncScriptParamsParams param) =>
            ComponentLifecycleOps.SyncScriptParams(doc, param);

        public static string GetScriptCode(GH_Document doc, GetScriptCodeParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"getScriptCode error: {err}";

                var reflector = GhScriptReflector.Get();
                var code = reflector.GetSourceCode(obj);

                return $"getScriptCode: code={code}";
            }
            catch (Exception ex)
            {
                return $"getScriptCode error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string AddInputParam(GH_Document doc, AddScriptInputParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"addScriptInput error: {err}";
                var comp = obj as GH_Component;
                if (comp == null) return $"addScriptInput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.AddScriptInputParam(comp, param.Name, access: param.Access, dataMapping: param.DataMapping, simplify: param.Simplify, reverse: param.Reverse, typeHint: param.TypeHint);
                comp.ExpireSolution(true);
                return $"addScriptInput: added input '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"addScriptInput error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string RemoveInputParam(GH_Document doc, RemoveScriptInputParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"removeScriptInput error: {err}";
                var comp = obj as GH_Component;
                if (comp == null) return $"removeScriptInput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.RemoveScriptInputParam(comp, param.Name);
                return $"removeScriptInput: removed input '{param.Name}' from ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"removeScriptInput error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string AddOutputParam(GH_Document doc, AddScriptOutputParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"addScriptOutput error: {err}";
                var comp = obj as GH_Component;
                if (comp == null) return $"addScriptOutput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.AddScriptOutputParam(comp, param.Name, dataMapping: param.DataMapping, simplify: param.Simplify, reverse: param.Reverse, typeHint: param.TypeHint);
                comp.ExpireSolution(true);
                return $"addScriptOutput: added output '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"addScriptOutput error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string RemoveOutputParam(GH_Document doc, RemoveScriptOutputParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"removeScriptOutput error: {err}";
                var comp = obj as GH_Component;
                if (comp == null) return $"removeScriptOutput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.RemoveScriptOutputParam(comp, param.Name);
                return $"removeScriptOutput: removed output '{param.Name}' from ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"removeScriptOutput error: {ex.GetType().Name}: {ex.Message}";
            }
        }
    }
}
