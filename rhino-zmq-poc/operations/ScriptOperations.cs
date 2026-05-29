using System;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class ScriptOperations
    {
        public static string CreateScriptNode(GH_Document doc, CreateScriptNodeParams param)
        {
            try
            {
                if (doc == null)
                    return "createScriptNode error: document is null";

                var reflector = GhScriptReflector.Get();
                var guid = reflector.ResolveLanguageGuid(param.Language);

                if (guid == Guid.Empty)
                    return $"createScriptNode error: unknown language '{param.Language}' (supported: {string.Join(", ", reflector.SupportedLanguages)})";

                var obj = Instances.ComponentServer.EmitObject(guid);
                if (obj == null)
                    return $"createScriptNode error: failed to emit script component for language '{param.Language}' (guid={guid})";

                doc.AddObject(obj, false);

                if (obj.Attributes == null)
                    return "createScriptNode error: Attributes is null after AddObject()";

                obj.Attributes.Pivot = new System.Drawing.PointF(
                    (float)param.Position.X,
                    (float)param.Position.Y);

                var hiddenProp = obj.GetType().GetProperty("Hidden");
                if (hiddenProp != null)
                    hiddenProp.SetValue(obj, true);

                var comp = obj as GH_Component;
                if (comp != null)
                {
                    ComponentLifecycleOps.ClearAllParams(comp);

                    if (param.Inputs != null && param.Inputs.Count > 0)
                    {
                        foreach (var input in param.Inputs)
                        {
                            ComponentLifecycleOps.AddScriptInputParam(comp, input.Name, access: input.Access, dataMapping: input.DataMapping, simplify: input.Simplify, reverse: input.Reverse, typeHint: input.TypeHint);
                        }
                    }

                    if (param.Outputs != null && param.Outputs.Count > 0)
                    {
                        foreach (var output in param.Outputs)
                            ComponentLifecycleOps.AddScriptOutputParam(comp, output.Name, dataMapping: output.DataMapping, simplify: output.Simplify, reverse: output.Reverse, typeHint: output.TypeHint);
                    }
                }
                obj.ExpireSolution(true);
                if (!string.IsNullOrWhiteSpace(param.Code))
                {
                    reflector.SetSource(obj, param.Code);
                }

                if (!string.IsNullOrWhiteSpace(param.NickName))
                {
                    obj.NickName = param.NickName;
                }
                else
                {
                    obj.NickName = param.Language == "python" ? "Py3" : "C#";
                }

                obj.ExpireSolution(true);

                return $"createScriptNode: added {param.Language} script ({obj.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
            }
            catch (Exception ex)
            {
                return $"createScriptNode CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SetScriptCode(GH_Document doc, SetScriptCodeParams param)
        {
            try
            {
                if (doc == null)
                    return "setScriptCode error: document is null";

                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"setScriptCode error: invalid targetId '{param.TargetId}'";

                IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
                if (obj == null)
                    return $"setScriptCode error: object not found '{param.TargetId}'";

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
                return $"setScriptCode CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SyncParams(GH_Document doc, SyncScriptParamsParams param) =>
            ComponentLifecycleOps.SyncScriptParams(doc, param);

        public static string GetScriptCode(GH_Document doc, GetScriptCodeParams param)
        {
            try
            {
                if (doc == null)
                    return "getScriptCode error: document is null";

                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"getScriptCode error: invalid targetId '{param.TargetId}'";

                IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
                if (obj == null)
                    return $"getScriptCode error: object not found '{param.TargetId}'";

                var reflector = GhScriptReflector.Get();
                var code = reflector.GetSourceCode(obj);

                return $"getScriptCode: code={code}";
            }
            catch (Exception ex)
            {
                return $"getScriptCode CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string AddInputParam(GH_Document doc, AddScriptInputParams param)
        {
            try
            {
                if (doc == null) return "addScriptInput error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"addScriptInput error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"addScriptInput error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"addScriptInput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.AddScriptInputParam(comp, param.Name, access: param.Access, dataMapping: param.DataMapping, simplify: param.Simplify, reverse: param.Reverse, typeHint: param.TypeHint);
                comp.ExpireSolution(true);
                return $"addScriptInput: added input '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"addScriptInput CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string RemoveInputParam(GH_Document doc, RemoveScriptInputParams param)
        {
            try
            {
                if (doc == null) return "removeScriptInput error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"removeScriptInput error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"removeScriptInput error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"removeScriptInput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.RemoveScriptInputParam(comp, param.Name);
                return $"removeScriptInput: removed input '{param.Name}' from ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"removeScriptInput CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string AddOutputParam(GH_Document doc, AddScriptOutputParams param)
        {
            try
            {
                if (doc == null) return "addScriptOutput error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"addScriptOutput error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"addScriptOutput error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"addScriptOutput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.AddScriptOutputParam(comp, param.Name, dataMapping: param.DataMapping, simplify: param.Simplify, reverse: param.Reverse, typeHint: param.TypeHint);
                comp.ExpireSolution(true);
                return $"addScriptOutput: added output '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"addScriptOutput CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string RemoveOutputParam(GH_Document doc, RemoveScriptOutputParams param)
        {
            try
            {
                if (doc == null) return "removeScriptOutput error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"removeScriptOutput error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"removeScriptOutput error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"removeScriptOutput error: '{param.TargetId}' is not a GH_Component";
                ComponentLifecycleOps.RemoveScriptOutputParam(comp, param.Name);
                return $"removeScriptOutput: removed output '{param.Name}' from ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"removeScriptOutput CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }
    }
}
