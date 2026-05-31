using System;
using System.Collections.Generic;
using System.Linq;
using Rhino;
using Rhino.DocObjects;

namespace rhino_zmq_poc
{
    public class RhinoObjectInfo
    {
        public string ObjectId { get; set; }
        public string Name { get; set; }
        public string Layer { get; set; }
        public string ObjectType { get; set; }
    }

    public class QueryRhinoObjectsParams
    {
        public bool? SelectionOnly { get; set; }
        public string Layer { get; set; }
        public List<string> ObjectIds { get; set; }
        public string ObjectType { get; set; }
    }

    public static class RhinoObjectQuery
    {
        public static List<RhinoObjectInfo> Query(RhinoDoc doc, QueryRhinoObjectsParams param)
        {
            if (doc == null)
                return new List<RhinoObjectInfo>();

            IEnumerable<RhinoObject> objects = doc.Objects.GetObjectList(ObjectType.AnyObject);

            if (param?.SelectionOnly == true)
            {
                var selected = doc.Objects.GetSelectedObjects(false, false);
                objects = selected ?? Array.Empty<RhinoObject>();
            }

            if (param?.ObjectIds != null && param.ObjectIds.Count > 0)
            {
                var ids = new HashSet<Guid>();
                foreach (var raw in param.ObjectIds)
                {
                    if (Guid.TryParse(raw, out var id))
                        ids.Add(id);
                }
                objects = objects.Where(o => ids.Contains(o.Id));
            }

            if (!string.IsNullOrWhiteSpace(param?.Layer))
            {
                var layerIndex = doc.Layers.FindByFullPath(param.Layer, -1);
                if (layerIndex < 0)
                    return new List<RhinoObjectInfo>();
                objects = objects.Where(o => o.Attributes.LayerIndex == layerIndex);
            }

            var typeFilter = NormalizeObjectType(param?.ObjectType);
            if (!string.IsNullOrEmpty(typeFilter))
                objects = objects.Where(o => MatchesType(o, typeFilter));

            return objects
                .Select(o => new RhinoObjectInfo
                {
                    ObjectId = o.Id.ToString(),
                    Name = o.Name ?? "",
                    Layer = doc.Layers[o.Attributes.LayerIndex]?.Name ?? "",
                    ObjectType = DescribeObjectType(o),
                })
                .OrderBy(x => x.Layer)
                .ThenBy(x => x.Name)
                .ThenBy(x => x.ObjectId)
                .ToList();
        }

        private static string NormalizeObjectType(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var t = raw.Trim().ToLowerInvariant();
            return t switch
            {
                "any" or "*" => null,
                "curve" or "curves" => "curve",
                "point" or "points" => "point",
                "brep" or "breps" or "polysurface" or "polysurfaces" => "brep",
                "surface" or "surfaces" => "surface",
                "mesh" or "meshes" => "mesh",
                _ => t,
            };
        }

        private static bool MatchesType(RhinoObject obj, string typeFilter)
        {
            return typeFilter switch
            {
                "curve" => obj.Geometry is Rhino.Geometry.Curve,
                "point" => obj.ObjectType == ObjectType.Point,
                "brep" => obj.Geometry is Rhino.Geometry.Brep || obj.Geometry is Rhino.Geometry.Extrusion,
                "surface" => obj.Geometry is Rhino.Geometry.Surface || obj.Geometry is Rhino.Geometry.BrepFace,
                "mesh" => obj.Geometry is Rhino.Geometry.Mesh,
                _ => DescribeObjectType(obj).Equals(typeFilter, StringComparison.OrdinalIgnoreCase),
            };
        }

        private static string DescribeObjectType(RhinoObject obj)
        {
            if (obj.ObjectType == ObjectType.Point) return "point";
            if (obj.Geometry is Rhino.Geometry.Curve) return "curve";
            if (obj.Geometry is Rhino.Geometry.Mesh) return "mesh";
            if (obj.Geometry is Rhino.Geometry.Extrusion) return "brep";
            if (obj.Geometry is Rhino.Geometry.Brep) return "brep";
            if (obj.Geometry is Rhino.Geometry.Surface) return "surface";
            return obj.ObjectType.ToString().ToLowerInvariant();
        }
    }
}
