using System;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class ComponentLifecycleOps
    {
        public static string AddComponentToCanvas(GH_Document doc, AddComponentParams param)
        {
            try
            {
                if (doc == null)
                    return "addComponent error: document is null";

                if (!Guid.TryParse(param.TypeGuid, out var componentGuid))
                    return $"addComponent error: invalid typeGuid '{param.TypeGuid}'";

                var obj = Instances.ComponentServer.EmitObject(componentGuid);
                if (obj == null)
                    return $"addComponent error: failed to emit object for typeGuid '{param.TypeGuid}'";

                doc.AddObject(obj, false);

                if (obj.Attributes == null)
                    return "addComponent error: Attributes is null after AddObject()";

                obj.Attributes.Pivot = new System.Drawing.PointF(
                    (float)param.Position.X,
                    (float)param.Position.Y);

                if (!param.Preview)
                {
                    var hiddenProp = obj.GetType().GetProperty("Hidden");
                    if (hiddenProp != null)
                        hiddenProp.SetValue(obj, true);
                }

                return $"addComponent: added ({obj.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) preview={param.Preview}";
            }
            catch (Exception ex)
            {
                return $"addComponent CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string DeleteComponent(GH_Document doc, DeleteComponentParams param)
        {
            if (doc == null)
                return "deleteComponent error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"deleteComponent error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"deleteComponent error: object not found '{param.TargetId}'";

            doc.RemoveObject(obj, false);

            return $"deleteComponent: removed ({param.TargetId})";
        }

        public static string MoveComponent(GH_Document doc, MoveComponentParams param)
        {
            if (doc == null)
                return "moveComponent error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"moveComponent error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"moveComponent error: object not found '{param.TargetId}'";

            obj.Attributes.Pivot = new System.Drawing.PointF(
                (float)param.Position.X,
                (float)param.Position.Y);

            obj.Attributes?.ExpireLayout();
            obj.OnDisplayExpired(true);

            return $"moveComponent: moved ({param.TargetId}) to ({param.Position.X}, {param.Position.Y})";
        }

        public static void AddScriptInputParam(GH_Component comp, string name, IGH_Param param = null, string access = null, string dataMapping = null, bool? simplify = null, bool? reverse = null)
        {
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = comp.Params.Input.Count;
                if (vpc.CanInsertParameter(GH_ParameterSide.Input, index))
                {
                    IGH_Param p = param ?? vpc.CreateParameter(GH_ParameterSide.Input, index);
                    p.Name = name;
                    p.NickName = name;
                    p.Access = GH_ParamAccess.item;

                    if (!string.IsNullOrEmpty(access))
                    {
                        switch (access.ToLowerInvariant())
                        {
                            case "list": p.Access = GH_ParamAccess.list; break;
                            case "tree": p.Access = GH_ParamAccess.tree; break;
                        }
                    }

                    ApplyDataMapping(p, dataMapping, simplify, reverse);

                    comp.Params.RegisterInputParam(p);
                    vpc.VariableParameterMaintenance();
                    comp.Params.OnParametersChanged();
                }
            }
        }

        public static void RemoveScriptInputParam(GH_Component comp, string name)
        {
            var target = comp.Params.Input.FirstOrDefault(x =>
                string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (target == null) return;
            comp.RecordUndoEvent("Remove input");
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = comp.Params.Input.IndexOf(target);
                if (!vpc.CanRemoveParameter(GH_ParameterSide.Input, index)) return;
                vpc.DestroyParameter(GH_ParameterSide.Input, index);
            }
            comp.Params.UnregisterInputParameter(target, true);
            comp.Params.OnParametersChanged();
            comp.ExpireSolution(true);
        }

        public static void AddScriptOutputParam(GH_Component comp, string name, string dataMapping = null, bool? simplify = null, bool? reverse = null)
        {
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = comp.Params.Output.Count;
                if (vpc.CanInsertParameter(GH_ParameterSide.Output, index))
                {
                    IGH_Param p = vpc.CreateParameter(GH_ParameterSide.Output, index);
                    p.Name = name;
                    p.NickName = name;
                    p.Access = GH_ParamAccess.item;

                    ApplyDataMapping(p, dataMapping, simplify, reverse);

                    comp.Params.RegisterOutputParam(p);
                    vpc.VariableParameterMaintenance();
                    comp.Params.OnParametersChanged();
                }
            }
        }

        public static void RemoveScriptOutputParam(GH_Component comp, string name)
        {
            var target = comp.Params.Output.FirstOrDefault(x =>
                string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (target == null) return;
            comp.RecordUndoEvent("Remove output");
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = comp.Params.Output.IndexOf(target);
                if (!vpc.CanRemoveParameter(GH_ParameterSide.Output, index)) return;
                vpc.DestroyParameter(GH_ParameterSide.Output, index);
            }
            comp.Params.UnregisterOutputParameter(target, true);
            comp.Params.OnParametersChanged();
            comp.ExpireSolution(true);
        }

        public static void ClearAllParams(GH_Component comp)
        {
            if (comp == null) return;

            while (comp.Params.Input.Count > 0)
            {
                int index = 0;
                if (comp is IGH_VariableParameterComponent vpc && vpc.CanRemoveParameter(GH_ParameterSide.Input, index))
                {
                    vpc.DestroyParameter(GH_ParameterSide.Input, index);
                }
                comp.Params.UnregisterInputParameter(comp.Params.Input[index], true);
            }

            while (comp.Params.Output.Count > 0)
            {
                int index = 0;
                if (comp is IGH_VariableParameterComponent vpc && vpc.CanRemoveParameter(GH_ParameterSide.Output, index))
                {
                    vpc.DestroyParameter(GH_ParameterSide.Output, index);
                }
                comp.Params.UnregisterOutputParameter(comp.Params.Output[index], true);
            }

            comp.Params.OnParametersChanged();
        }

        public static string EditScriptAccessType(GH_Document doc, EditScriptAccessParams param)
        {
            try
            {
                if (doc == null) return "editScriptAccess error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"editScriptAccess error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"editScriptAccess error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"editScriptAccess error: '{param.TargetId}' is not a GH_Component";
                var target = comp.Params.Input.FirstOrDefault(x =>
                    string.Equals(x.Name, param.Name, StringComparison.OrdinalIgnoreCase));
                if (target == null) return $"editScriptAccess error: input '{param.Name}' not found";
                switch (param.Access.ToLowerInvariant())
                {
                    case "item": target.Access = GH_ParamAccess.item; break;
                    case "list": target.Access = GH_ParamAccess.list; break;
                    case "tree": target.Access = GH_ParamAccess.tree; break;
                    default: return $"editScriptAccess error: unknown access type '{param.Access}' (supported: item, list, tree)";
                }
                comp.ExpireSolution(true);
                return $"editScriptAccess: set input '{param.Name}' access to {param.Access} on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"editScriptAccess CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string ListScriptParams(GH_Document doc, ListScriptParamsParams param)
        {
            try
            {
                if (doc == null) return "listScriptParams error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"listScriptParams error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"listScriptParams error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"listScriptParams error: '{param.TargetId}' is not a GH_Component";

                var inputInfo = comp.Params.Input.Select(p =>
                    $"{p.Name}({Utilities.AccessStr(p.Access)},{Utilities.MappingStr(p.DataMapping)},{p.Simplify.ToString().ToLower()},{p.Reverse.ToString().ToLower()})").ToArray();
                var outputInfo = comp.Params.Output.Select(p =>
                    $"{p.Name}({Utilities.AccessStr(p.Access)},{Utilities.MappingStr(p.DataMapping)},{p.Simplify.ToString().ToLower()},{p.Reverse.ToString().ToLower()})").ToArray();

                return $"inputs: [{string.Join(", ", inputInfo)}] outputs: [{string.Join(", ", outputInfo)}]";
            }
            catch (Exception ex)
            {
                return $"listScriptParams CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string EditParamProps(GH_Document doc, EditParamPropsParams param)
        {
            try
            {
                if (doc == null) return "editParamProps error: document is null";
                if (!Guid.TryParse(param.TargetId, out var targetGuid))
                    return $"editParamProps error: invalid targetId '{param.TargetId}'";
                var obj = doc.FindObject(targetGuid, false);
                if (obj == null) return $"editParamProps error: object not found '{param.TargetId}'";
                var comp = obj as GH_Component;
                if (comp == null) return $"editParamProps error: '{param.TargetId}' is not a GH_Component";

                var target = comp.Params.Input.Cast<IGH_Param>().Concat(comp.Params.Output.Cast<IGH_Param>())
                    .FirstOrDefault(x => string.Equals(x.Name, param.Name, StringComparison.OrdinalIgnoreCase));
                if (target == null) return $"editParamProps error: param '{param.Name}' not found on inputs or outputs";

                if (param.DataMapping != null)
                {
                    switch (param.DataMapping.ToLowerInvariant())
                    {
                        case "none": target.DataMapping = GH_DataMapping.None; break;
                        case "flatten": target.DataMapping = GH_DataMapping.Flatten; break;
                        case "graft": target.DataMapping = GH_DataMapping.Graft; break;
                        default: return $"editParamProps error: unknown dataMapping '{param.DataMapping}' (supported: none, flatten, graft)";
                    }
                }

                if (param.Simplify.HasValue)
                    target.Simplify = param.Simplify.Value;

                if (param.Reverse.HasValue)
                    target.Reverse = param.Reverse.Value;

                comp.ExpireSolution(true);
                return $"editParamProps: updated param '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return $"editParamProps CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        private static void ApplyDataMapping(IGH_Param p, string dataMapping, bool? simplify, bool? reverse)
        {
            if (!string.IsNullOrEmpty(dataMapping))
            {
                switch (dataMapping.ToLowerInvariant())
                {
                    case "none": p.DataMapping = GH_DataMapping.None; break;
                    case "flatten": p.DataMapping = GH_DataMapping.Flatten; break;
                    case "graft": p.DataMapping = GH_DataMapping.Graft; break;
                }
            }
            if (simplify.HasValue)
                p.Simplify = simplify.Value;
            if (reverse.HasValue)
                p.Reverse = reverse.Value;
        }
    }
}
