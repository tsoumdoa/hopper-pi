using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class ComponentLifecycleOps
    {
        public static string AddComponentToCanvas(GH_Document doc, AddComponentParams param)
        {
            try
            {
                if (!GraphObjectFactory.TryCreateComponent(
                    doc, param, null, out var obj, out var error))
                    return CommandOperationException.Fail($"addComponent error: {error}");
                return $"addComponent: added ({obj.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) preview={param.Preview}";
            }
            catch (Exception ex)
            {
                return CommandOperationException.Fail($"addComponent error: {ex.GetType().Name}: {ex.Message}");
            }
        }

        public static string DeleteComponent(GH_Document doc, DeleteComponentParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"deleteComponent error: {err}");

            doc.RemoveObject(obj, false);

            return $"deleteComponent: removed ({param.TargetId})";
        }

        public static string MoveComponent(GH_Document doc, MoveComponentParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"moveComponent error: {err}");

            obj.Attributes.Pivot = new System.Drawing.PointF(
                (float)param.Position.X,
                (float)param.Position.Y);

            obj.Attributes?.ExpireLayout();
            obj.OnDisplayExpired(true);

            return $"moveComponent: moved ({param.TargetId}) to ({param.Position.X}, {param.Position.Y})";
        }

        public static void AddScriptInputParam(GH_Component comp, string name, IGH_Param param = null, string access = null, string dataMapping = null, bool? simplify = null, bool? reverse = null, string typeHint = null, int? insertIndex = null)
        {
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = insertIndex ?? comp.Params.Input.Count;
                if (vpc.CanInsertParameter(GH_ParameterSide.Input, index))
                {
                    IGH_Param p = param ?? vpc.CreateParameter(GH_ParameterSide.Input, index);
                    p.Name = name;
                    p.NickName = name;
                    ApplyScriptParamProps(p, access, dataMapping, simplify, reverse, typeHint);

                    comp.Params.RegisterInputParam(p, index);
                    vpc.VariableParameterMaintenance();
                    comp.Params.OnParametersChanged();
                }
            }
        }

        public static void RemoveScriptInputParam(GH_Component comp, string name, bool recordUndo = true)
        {
            var target = comp.Params.Input.FirstOrDefault(x =>
                string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (target == null) return;
			if (recordUndo && !AgentTransaction.IsActive)
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

        public static void AddScriptOutputParam(GH_Component comp, string name, string dataMapping = null, bool? simplify = null, bool? reverse = null, string typeHint = null, int? insertIndex = null)
        {
            if (comp is IGH_VariableParameterComponent vpc)
            {
                int index = insertIndex ?? comp.Params.Output.Count;
                if (vpc.CanInsertParameter(GH_ParameterSide.Output, index))
                {
                    IGH_Param p = vpc.CreateParameter(GH_ParameterSide.Output, index);
                    p.Name = name;
                    p.NickName = name;
                    ApplyScriptParamProps(p, null, dataMapping, simplify, reverse, typeHint);

                    comp.Params.RegisterOutputParam(p, index);
                    vpc.VariableParameterMaintenance();
                    comp.Params.OnParametersChanged();
                }
            }
        }

        public static void RemoveScriptOutputParam(GH_Component comp, string name, bool recordUndo = true)
        {
            var target = comp.Params.Output.FirstOrDefault(x =>
                string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (target == null) return;
			if (recordUndo && !AgentTransaction.IsActive)
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

        public static string SyncScriptParams(GH_Document doc, SyncScriptParamsParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"syncScriptParams error: {err}");
                var comp = obj as GH_Component;
                if (comp == null) return CommandOperationException.Fail($"syncScriptParams error: '{param.TargetId}' is not a GH_Component");
                if (param.Inputs == null && param.Outputs == null)
                    return CommandOperationException.Fail("syncScriptParams error: at least one of inputs or outputs is required");

				if (!AgentTransaction.IsActive)
					comp.RecordUndoEvent("Sync script params");
                SyncScriptParams(comp, param.Inputs, param.Outputs);
                comp.ExpireSolution(true);
                return $"syncScriptParams: reconciled I/O on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return CommandOperationException.Fail($"syncScriptParams error: {ex.GetType().Name}: {ex.Message}");
            }
        }

        public static void SyncScriptParams(GH_Component comp, List<ScriptIOParam> inputs, List<ScriptIOParam> outputs)
        {
            if (comp == null) return;
            if (!(comp is IGH_VariableParameterComponent vpc)) return;

            // null = leave this side unchanged; empty list = remove all ports on this side
            if (inputs != null)
                SyncScriptParamSide(comp, vpc, GH_ParameterSide.Input, inputs);
            if (outputs != null)
                SyncScriptParamSide(comp, vpc, GH_ParameterSide.Output, outputs);

            vpc.VariableParameterMaintenance();
            comp.Params.OnParametersChanged();
        }

        private static void SyncScriptParamSide(GH_Component comp, IGH_VariableParameterComponent vpc, GH_ParameterSide side, List<ScriptIOParam> desired)
        {
            if (desired == null) return;

            var explicitRenamed = new HashSet<Guid>();
            ApplyExplicitPreviousNameRenames(comp, side, desired, explicitRenamed);
            ApplyIndexAlignedRenames(comp, side, desired, explicitRenamed);

            var desiredNames = new HashSet<string>(
                desired.Where(d => d != null && !string.IsNullOrWhiteSpace(d.Name)).Select(d => d.Name),
                StringComparer.OrdinalIgnoreCase);

            var collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
            var toRemove = collection
                .Where(p => !desiredNames.Contains(p.Name))
                .Select(p => p.Name)
                .ToList();

            foreach (var name in toRemove)
            {
                if (side == GH_ParameterSide.Input)
                    RemoveScriptInputParam(comp, name, recordUndo: false);
                else
                    RemoveScriptOutputParam(comp, name, recordUndo: false);
            }

            for (int i = 0; i < desired.Count; i++)
            {
                var spec = desired[i];
                if (string.IsNullOrWhiteSpace(spec?.Name)) continue;

                var currentCollection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;

                IGH_Param atSlot = i < currentCollection.Count ? currentCollection[i] : null;
                if (atSlot != null && ParamNameMatches(atSlot, spec.Name))
                {
                    ApplyScriptParamPropsFromSpec(atSlot, spec);
                    continue;
                }

                var existing = currentCollection.FirstOrDefault(p => ParamNameMatches(p, spec.Name));
                if (existing != null)
                {
                    MoveScriptParamToIndex(comp, side, existing, i);
                    ApplyScriptParamPropsFromSpec(existing, spec);
                }
                else if (side == GH_ParameterSide.Input)
                {
                    AddScriptInputParam(comp, spec.Name, access: spec.Access, dataMapping: spec.DataMapping,
                        simplify: spec.Simplify, reverse: spec.Reverse, typeHint: spec.TypeHint, insertIndex: i);
                }
                else
                {
                    AddScriptOutputParam(comp, spec.Name, dataMapping: spec.DataMapping,
                        simplify: spec.Simplify, reverse: spec.Reverse, typeHint: spec.TypeHint, insertIndex: i);
                }
            }
        }

        private static void RenameScriptParam(IGH_Param param, string newName)
        {
            if (param == null || string.IsNullOrWhiteSpace(newName)) return;
            param.Name = newName;
            param.NickName = newName;
        }

        private static void ApplyExplicitPreviousNameRenames(
            GH_Component comp,
            GH_ParameterSide side,
            List<ScriptIOParam> desired,
            HashSet<Guid> renamed)
        {
            foreach (var spec in desired)
            {
                if (spec == null || string.IsNullOrWhiteSpace(spec.PreviousName) || string.IsNullOrWhiteSpace(spec.Name))
                    continue;
                if (string.Equals(spec.PreviousName, spec.Name, StringComparison.OrdinalIgnoreCase))
                    continue;

                var collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
                var param = collection.FirstOrDefault(p => ParamNameMatches(p, spec.PreviousName));
                if (param == null) continue;

                RenameScriptParam(param, spec.Name);
                ApplyScriptParamPropsFromSpec(param, spec);
                renamed.Add(param.InstanceGuid);
            }
        }

        private static void ApplyIndexAlignedRenames(
            GH_Component comp,
            GH_ParameterSide side,
            List<ScriptIOParam> desired,
            HashSet<Guid> skip)
        {
            var collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
            var pending = new List<(IGH_Param Param, string NewName)>();

            int slotCount = Math.Min(collection.Count, desired.Count);
            for (int i = 0; i < slotCount; i++)
            {
                var spec = desired[i];
                if (spec == null || string.IsNullOrWhiteSpace(spec.Name)) continue;
                if (!string.IsNullOrWhiteSpace(spec.PreviousName)) continue;

                var atSlot = collection[i];
                if (skip.Contains(atSlot.InstanceGuid)) continue;
                if (ParamNameMatches(atSlot, spec.Name)) continue;

                pending.Add((atSlot, spec.Name));
            }

            var deferred = new List<(IGH_Param Param, string NewName)>();
            foreach (var (param, newName) in pending)
            {
                collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
                bool nameTaken = collection.Any(p => p != param && ParamNameMatches(p, newName));
                if (!nameTaken)
                    RenameScriptParam(param, newName);
                else
                    deferred.Add((param, newName));
            }

            if (deferred.Count == 0) return;

            int tmpIndex = 0;
            var deferredGuids = new List<Guid>();
            foreach (var (param, _) in deferred)
            {
                deferredGuids.Add(param.InstanceGuid);
                RenameScriptParam(param, $"__hopper_tmp_{tmpIndex++}");
            }

            collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
            for (int i = 0; i < deferred.Count; i++)
            {
                var guid = deferredGuids[i];
                var newName = deferred[i].NewName;
                var param = collection.FirstOrDefault(p => p.InstanceGuid == guid);
                if (param != null)
                    RenameScriptParam(param, newName);
            }
        }

        private static bool ParamNameMatches(IGH_Param param, string name) =>
            string.Equals(param.Name, name, StringComparison.OrdinalIgnoreCase)
            || string.Equals(param.NickName, name, StringComparison.OrdinalIgnoreCase);

        private static void MoveScriptParamToIndex(GH_Component comp, GH_ParameterSide side, IGH_Param param, int targetIndex)
        {
            var collection = side == GH_ParameterSide.Input ? comp.Params.Input : comp.Params.Output;
            int currentIndex = collection.IndexOf(param);
            if (currentIndex < 0 || currentIndex == targetIndex) return;

            if (side == GH_ParameterSide.Input)
            {
                comp.Params.UnregisterInputParameter(param, false);
                comp.Params.RegisterInputParam(param, targetIndex);
            }
            else
            {
                comp.Params.UnregisterOutputParameter(param, false);
                comp.Params.RegisterOutputParam(param, targetIndex);
            }
        }

        public static string EditParamProps(GH_Document doc, EditParamPropsParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"editParamProps error: {err}");
                var comp = obj as GH_Component;
                if (comp == null) return CommandOperationException.Fail($"editParamProps error: '{param.TargetId}' is not a GH_Component");

                var target = comp.Params.Input.Cast<IGH_Param>().Concat(comp.Params.Output.Cast<IGH_Param>())
                    .FirstOrDefault(x => string.Equals(x.Name, param.Name, StringComparison.OrdinalIgnoreCase)
                                        || string.Equals(x.NickName, param.Name, StringComparison.OrdinalIgnoreCase));
                if (target == null) return CommandOperationException.Fail($"editParamProps error: param '{param.Name}' not found on inputs or outputs");

                if (param.Access != null)
                {
                    switch (param.Access.ToLowerInvariant())
                    {
                        case "item": target.Access = GH_ParamAccess.item; break;
                        case "list": target.Access = GH_ParamAccess.list; break;
                        case "tree": target.Access = GH_ParamAccess.tree; break;
                        default: return CommandOperationException.Fail($"editParamProps error: unknown access type '{param.Access}' (supported: item, list, tree)");
                    }
                }

                if (param.DataMapping != null)
                {
                    switch (param.DataMapping.ToLowerInvariant())
                    {
                        case "none": target.DataMapping = GH_DataMapping.None; break;
                        case "flatten": target.DataMapping = GH_DataMapping.Flatten; break;
                        case "graft": target.DataMapping = GH_DataMapping.Graft; break;
                        default: return CommandOperationException.Fail($"editParamProps error: unknown dataMapping '{param.DataMapping}' (supported: none, flatten, graft)");
                    }
                }

                if (param.Simplify.HasValue)
                    target.Simplify = param.Simplify.Value;

                if (param.Reverse.HasValue)
                    target.Reverse = param.Reverse.Value;

                if (param.TypeHint != null)
                    GhScriptReflector.ApplyTypeHint(target, param.TypeHint);

                comp.Params.OnParametersChanged();
                comp.Attributes?.ExpireLayout();
                comp.OnDisplayExpired(true);
                comp.ExpireSolution(true);
                return $"editParamProps: updated param '{param.Name}' on ({param.TargetId})";
            }
            catch (Exception ex)
            {
                return CommandOperationException.Fail($"editParamProps error: {ex.GetType().Name}: {ex.Message}");
            }
        }

        public static string ListScriptParams(GH_Document doc, ListScriptParamsParams param)
        {
            try
            {
                if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"listScriptParams error: {err}");
                var comp = obj as GH_Component;
                if (comp == null) return CommandOperationException.Fail($"listScriptParams error: '{param.TargetId}' is not a GH_Component");

                var inputInfo = comp.Params.Input.Select(p =>
                    $"{p.Name}({Utilities.AccessStr(p.Access)},{Utilities.MappingStr(p.DataMapping)},{p.Simplify.ToString().ToLower()},{p.Reverse.ToString().ToLower()},{GhScriptReflector.GetTypeHintName(p)})").ToArray();
                var outputInfo = comp.Params.Output.Select(p =>
                    $"{p.Name}({Utilities.AccessStr(p.Access)},{Utilities.MappingStr(p.DataMapping)},{p.Simplify.ToString().ToLower()},{p.Reverse.ToString().ToLower()},{GhScriptReflector.GetTypeHintName(p)})").ToArray();

                return $"inputs: [{string.Join(", ", inputInfo)}] outputs: [{string.Join(", ", outputInfo)}]";
            }
            catch (Exception ex)
            {
                return CommandOperationException.Fail($"listScriptParams error: {ex.GetType().Name}: {ex.Message}");
            }
        }

        private static void ApplyScriptParamPropsFromSpec(IGH_Param p, ScriptIOParam spec)
        {
            if (p == null || spec == null) return;
            ApplyScriptParamProps(p, spec.Access, spec.DataMapping, spec.Simplify, spec.Reverse, spec.TypeHint);
        }

        private static void ApplyScriptParamProps(IGH_Param p, string access, string dataMapping, bool? simplify, bool? reverse, string typeHint)
        {
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
            GhScriptReflector.ApplyTypeHint(p, typeHint);
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
