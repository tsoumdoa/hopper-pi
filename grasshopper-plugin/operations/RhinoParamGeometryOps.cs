using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json.Serialization;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace rhino_zmq_poc
{
    internal class SetParamRhinoGeometryParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }

        [JsonPropertyName("mode")]
        public string Mode { get; set; }

        [JsonPropertyName("rhinoObjectIds")]
        public List<string> RhinoObjectIds { get; set; }

        [JsonPropertyName("rhinoQuery")]
        public QueryRhinoObjectsParams RhinoQuery { get; set; }
    }

    internal class GetParamRhinoGeometryParams
    {
        [JsonPropertyName("targetId")]
        public string TargetId { get; set; }
    }

    internal class ParamRhinoGeometryItem
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("gooType")]
        public string GooType { get; set; }

        [JsonPropertyName("rhinoObjectId")]
        public string RhinoObjectId { get; set; }

        [JsonPropertyName("source")]
        public string Source { get; set; }
    }

    internal class GetParamRhinoGeometryResult
    {
        public string TargetId { get; set; }
        public string ParamName { get; set; }
        public List<ParamRhinoGeometryItem> Volatile { get; set; } = new();
        public List<ParamRhinoGeometryItem> Persistent { get; set; } = new();
    }

    internal static class RhinoParamGeometryOps
    {
        public const int MaxRhinoObjectIds = 30;

        public static string SetParamRhinoGeometry(GH_Document doc, RhinoDoc rhinoDoc, SetParamRhinoGeometryParams param)
        {
            if (doc == null) return CommandOperationException.Fail("setParamRhinoGeometry error: Grasshopper document is null");
            if (rhinoDoc == null) return CommandOperationException.Fail("setParamRhinoGeometry error: no active Rhino document");
            if (param == null) return CommandOperationException.Fail("setParamRhinoGeometry error: invalid params");
            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return CommandOperationException.Fail($"setParamRhinoGeometry error: invalid targetId '{param.TargetId}'");
            var hasIds = param.RhinoObjectIds != null && param.RhinoObjectIds.Count > 0;
            var hasQuery = param.RhinoQuery != null && (
                param.RhinoQuery.SelectionOnly == true
                || !string.IsNullOrWhiteSpace(param.RhinoQuery.Layer)
                || !string.IsNullOrWhiteSpace(param.RhinoQuery.ObjectType)
                || (param.RhinoQuery.ObjectIds != null && param.RhinoQuery.ObjectIds.Count > 0));

            if (hasIds && hasQuery)
                return CommandOperationException.Fail("setParamRhinoGeometry error: provide rhinoObjectIds or rhinoQuery, not both");
            if (!hasIds && !hasQuery)
            {
                if (param.RhinoQuery != null)
                    return CommandOperationException.Fail("setParamRhinoGeometry error: rhinoQuery must include layer, objectType, or selectionOnly");
                return CommandOperationException.Fail("setParamRhinoGeometry error: rhinoObjectIds or rhinoQuery is required");
            }

            if (hasIds && param.RhinoObjectIds.Count > MaxRhinoObjectIds)
				return CommandOperationException.Fail($"setParamRhinoGeometry error: rhinoObjectIds accepts at most {MaxRhinoObjectIds} IDs; use rhinoQuery for bulk");

            List<string> objectIds;
            string queryNote = null;
            if (hasQuery)
            {
                var matched = RhinoObjectQuery.Query(rhinoDoc, param.RhinoQuery);
                if (matched.Count == 0)
                    return CommandOperationException.Fail("setParamRhinoGeometry error: rhinoQuery matched no Rhino objects");
                objectIds = matched.Select(o => o.ObjectId).ToList();
                queryNote = FormatRhinoQueryNote(param.RhinoQuery, matched.Count);
            }
            else
            {
                objectIds = param.RhinoObjectIds;
            }

            var mode = (param.Mode ?? "").Trim().ToLowerInvariant();
            if (mode != "reference" && mode != "internalize")
                return CommandOperationException.Fail($"setParamRhinoGeometry error: unknown mode '{param.Mode}'");

            var obj = doc.FindObject(targetGuid, true);
            if (obj is not IGH_Param ghParam)
                return CommandOperationException.Fail($"setParamRhinoGeometry error: '{param.TargetId}' is not a Grasshopper parameter");

            var reference = mode == "reference";
            ghParam.RemoveAllSources();
            ghParam.ClearData();
            ClearPersistent(ghParam);

            foreach (var rawId in objectIds)
            {
                if (!Guid.TryParse(rawId, out var rhinoObjectId))
                    return CommandOperationException.Fail($"setParamRhinoGeometry error: invalid rhinoObjectId '{rawId}'");

                var rhinoObj = rhinoDoc.Objects.FindId(rhinoObjectId);
                if (rhinoObj == null)
                    return CommandOperationException.Fail($"setParamRhinoGeometry error: Rhino object not found '{rawId}'");

                if (!TryCreateGoo(rhinoObj, reference, out var goo, out var gooError))
                    return CommandOperationException.Fail($"setParamRhinoGeometry error: {gooError}");

                if (!AppendPersistent(ghParam, goo, out var appendError))
                    return CommandOperationException.Fail($"setParamRhinoGeometry error: {appendError}");
            }

            ghParam.OnObjectChanged(GH_ObjectEventType.PersistentData);
            ghParam.ExpireSolution(true);

            var count = objectIds.Count;
            if (!string.IsNullOrEmpty(queryNote))
                return $"setParamRhinoGeometry: {mode} {count} object(s) on ({param.TargetId}) via {queryNote}";
            return $"setParamRhinoGeometry: {mode} {count} object(s) on ({param.TargetId})";
        }

        private static string FormatRhinoQueryNote(QueryRhinoObjectsParams query, int count)
        {
            var parts = new List<string> { $"rhinoQuery matched {count}" };
            if (query.SelectionOnly == true)
                parts.Add("selectionOnly");
            if (!string.IsNullOrWhiteSpace(query.Layer))
                parts.Add($"layer=\"{query.Layer}\"");
            if (!string.IsNullOrWhiteSpace(query.ObjectType))
                parts.Add($"type={query.ObjectType}");
            return string.Join(", ", parts);
        }

        public static GetParamRhinoGeometryResult GetParamRhinoGeometry(GH_Document doc, GetParamRhinoGeometryParams param)
        {
            if (param == null || !Guid.TryParse(param.TargetId, out var targetGuid))
                throw new ArgumentException("invalid targetId");

            var obj = doc.FindObject(targetGuid, true);
            if (obj is not IGH_Param ghParam)
                throw new ArgumentException($"'{param.TargetId}' is not a Grasshopper parameter");

            var result = new GetParamRhinoGeometryResult
            {
                TargetId = param.TargetId,
                ParamName = ghParam.Name,
                Volatile = ReadVolatileItems(ghParam.VolatileData),
                Persistent = ReadPersistentItems(ghParam),
            };

            return result;
        }

        private static bool TryCreateGoo(RhinoObject rhinoObj, bool reference, out IGH_Goo goo, out string error)
        {
            return reference
                ? TryCreateReferencedGoo(rhinoObj, out goo, out error)
                : TryCreateInternalizedGoo(rhinoObj, out goo, out error);
        }

        /// <summary>Live Rhino link via GH_*(rhinoId) — no Duplicate(). Avoids GH_ObjectWrapper from GH_Convert.</summary>
        private static bool TryCreateReferencedGoo(RhinoObject rhinoObj, out IGH_Goo goo, out string error)
        {
            goo = null;
            error = null;

            try
            {
                var id = rhinoObj.Id;
                goo = rhinoObj switch
                {
                    PointObject => new GH_Point(id),
                    _ when rhinoObj.Geometry is Curve => new GH_Curve(id),
                    _ when rhinoObj.Geometry is Brep => new GH_Brep(id),
                    _ when rhinoObj.Geometry is Extrusion => new GH_Brep(id),
                    _ when rhinoObj.Geometry is Mesh => new GH_Mesh(id),
                    _ when rhinoObj.Geometry is Surface => new GH_Surface(id),
                    _ => UnwrapGoo(GH_Convert.ToGeometricGoo(new ObjRef(rhinoObj))
                        ?? GH_Convert.ToGoo(new ObjRef(rhinoObj))),
                };

                if (goo == null)
                {
                    error = "could not create referenced goo for this Rhino object";
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        /// <summary>Copy geometry into GH — Duplicate() then no ReferenceID.</summary>
        private static bool TryCreateInternalizedGoo(RhinoObject rhinoObj, out IGH_Goo goo, out string error)
        {
            goo = null;
            error = null;

            try
            {
                var geometry = DuplicateRhinoGeometry(rhinoObj);
                if (geometry == null)
                {
                    error = "unsupported Rhino geometry type";
                    return false;
                }

                goo = geometry switch
                {
                    Curve curve => new GH_Curve(curve),
                    Brep brep => new GH_Brep(brep),
                    Mesh mesh => new GH_Mesh(mesh),
                    Surface surface => new GH_Surface(surface),
                    Point point => new GH_Point(point.Location),
                    _ => UnwrapGoo(GH_Convert.ToGoo(geometry) ?? GH_Convert.ToGeometricGoo(geometry)),
                };

                if (goo == null)
                {
                    error = "GH_Convert could not create goo from duplicated geometry";
                    return false;
                }

                if (goo is IGH_GeometricGoo geom)
                    geom.ReferenceID = Guid.Empty;

                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        private static GeometryBase DuplicateRhinoGeometry(RhinoObject rhinoObj)
        {
            if (rhinoObj is PointObject pointObj)
                return pointObj.PointGeometry;

            return rhinoObj.Geometry?.Duplicate();
        }

        private static void ClearPersistent(IGH_Param param)
        {
            if (!TryGetPersistentStructure(param, out var structure))
                return;
            structure.GetType().GetMethod("Clear")?.Invoke(structure, null);
        }

        private static IGH_Goo UnwrapGoo(IGH_Goo goo)
        {
            if (goo is not GH_ObjectWrapper)
                return goo;

            var value = goo.GetType().GetProperty("Value")?.GetValue(goo);
            return value as IGH_Goo ?? goo;
        }

        private static bool AppendPersistent(IGH_Param param, IGH_Goo goo, out string error)
        {
            error = null;
            goo = UnwrapGoo(goo);
            if (goo == null)
            {
                error = "goo is null";
                return false;
            }

            try
            {
                switch (param)
                {
                    case Param_Point p when goo is GH_Point pt:
                        p.PersistentData.Append(pt);
                        return true;
                    case Param_Curve p when goo is GH_Curve crv:
                        p.PersistentData.Append(crv);
                        return true;
                    case Param_Brep p when goo is GH_Brep brep:
                        p.PersistentData.Append(brep);
                        return true;
                    case Param_Surface p when goo is GH_Surface srf:
                        p.PersistentData.Append(srf);
                        return true;
                    case Param_Mesh p when goo is GH_Mesh mesh:
                        p.PersistentData.Append(mesh);
                        return true;
                }

                if (!TryGetPersistentStructure(param, out var structure))
                {
                    error = $"param '{param.Name}' has no PersistentData";
                    return false;
                }

                foreach (var method in structure.GetType().GetMethods())
                {
                    if (method.Name != "Append" || method.GetParameters().Length != 1)
                        continue;
                    var pt = method.GetParameters()[0].ParameterType;
                    if (!pt.IsInstanceOfType(goo) && !pt.IsAssignableFrom(goo.GetType()))
                        continue;
                    method.Invoke(structure, new object[] { goo });
                    return true;
                }

                error = $"PersistentData.Append not found for {goo.GetType().Name}";
                return false;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        private static bool TryGetPersistentStructure(IGH_Param param, out object structure)
        {
            structure = param.GetType().GetProperty("PersistentData")?.GetValue(param);
            return structure != null;
        }

        private static List<ParamRhinoGeometryItem> ReadPersistentItems(IGH_Param param)
        {
            if (!TryGetPersistentStructure(param, out var structure))
                return new List<ParamRhinoGeometryItem>();

            var items = new List<ParamRhinoGeometryItem>();
            var pathsProp = structure.GetType().GetProperty("Paths");
            if (pathsProp?.GetValue(structure) is not IEnumerable<GH_Path> paths)
                return items;

            var getBranch = structure.GetType().GetMethod("get_Branch", new[] { typeof(GH_Path) });
            if (getBranch == null)
                return items;

            foreach (var path in paths)
            {
                if (getBranch.Invoke(structure, new object[] { path }) is not System.Collections.IEnumerable branch)
                    continue;
                foreach (var item in branch)
                    items.Add(ItemFromGoo(path, item));
            }

            return items;
        }

        private static List<ParamRhinoGeometryItem> ReadVolatileItems(IGH_Structure data)
        {
            var items = new List<ParamRhinoGeometryItem>();
            if (data == null) return items;

            foreach (var path in data.Paths)
            {
                var branch = data.get_Branch(path);
                if (branch == null) continue;
                foreach (var item in branch)
                {
                    var entry = ItemFromGoo(path, item);
                    entry.Source = "volatile";
                    items.Add(entry);
                }
            }
            return items;
        }

        private static ParamRhinoGeometryItem ItemFromGoo(GH_Path path, object item)
        {
            var entry = new ParamRhinoGeometryItem
            {
                Path = path.ToString(),
                GooType = item?.GetType().Name ?? "null",
                Source = "persistent",
                RhinoObjectId = "",
            };
            if (item is IGH_GeometricGoo geom && geom.ReferenceID != Guid.Empty)
                entry.RhinoObjectId = geom.ReferenceID.ToString();
            return entry;
        }
    }
}
