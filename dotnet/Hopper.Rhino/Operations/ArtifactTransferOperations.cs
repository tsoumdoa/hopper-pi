using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;

namespace rhino_zmq_poc;

internal static class ArtifactTransferOperations
{
    // External instances, lights, annotation fonts, materials and plugin geometry need their own dependency adapters.
    private static bool Supported(GeometryBase geometry) => geometry is Point or PointCloud or Curve or Mesh or Brep or Surface or Extrusion;
    public static OperationResultV2 Execute(RpcOperation operation, JsonElement args)
    {
        var document = RhinoDoc.ActiveDoc ?? throw new InvalidOperationException("No captured Rhino document is active.");
        return operation == RpcOperation.exportRhinoArtifact ? Export(document, args) : Import(document, args);
    }
    private static OperationResultV2 Export(RhinoDoc document, JsonElement args)
    {
        var path = Path.GetFullPath(args.GetProperty("path").GetString()!);
        if (!Path.IsPathFullyQualified(args.GetProperty("path").GetString()!) || Path.GetExtension(path) != ".3dm" || File.Exists(path)) throw new InvalidOperationException("Artifact requires an unused absolute .3dm staging path.");
        var ids = args.GetProperty("objectIds").EnumerateArray().Select(x => Guid.Parse(x.GetString()!)).ToArray();
        if (ids.Length == 0 || ids.Length > 10000 || ids.Distinct().Count() != ids.Length) throw new InvalidOperationException("Select 1 to 10000 distinct source objects.");
        var selected = ids.Select(id => document.Objects.FindId(id) ?? throw new InvalidOperationException("A selected source object no longer exists.")).ToArray();
        foreach (var item in selected)
            if (!Supported(item.Geometry) || item.Attributes.MaterialIndex >= 0 || item.RenderMaterial != null)
                throw new InvalidOperationException("Unsupported geometry or material dependency. Initial transfer supports unmaterialed points, curves, surfaces, breps, extrusions and meshes.");
        using var model = new File3dm();
        model.Settings.ModelUnitSystem = document.ModelUnitSystem;
        model.Settings.ModelAbsoluteTolerance = document.ModelAbsoluteTolerance;
        model.Settings.ModelAngleToleranceRadians = document.ModelAngleToleranceRadians;
        foreach (var item in selected)
        {
            var attributes = new ObjectAttributes { ObjectId = item.Id, Name = item.Name, ObjectColor = item.Attributes.ObjectColor, ColorSource = item.Attributes.ColorSource };
            if (model.Objects.Add(item.Geometry, attributes) == Guid.Empty) throw new InvalidOperationException("Could not serialize every selected object.");
        }
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".3dm";
        try
        {
            if (!model.Write(temporary, 8)) throw new InvalidOperationException("Native .3dm export failed.");
            File.Move(temporary, path, overwrite: false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return DocumentSession.Result(new { units = document.ModelUnitSystem.ToString(), tolerance = document.ModelAbsoluteTolerance,
            absoluteTolerance = document.ModelAbsoluteTolerance, objectTypes = selected.Select(item => item.Geometry.ObjectType.ToString()).Distinct().ToArray(),
            byteLength = new FileInfo(path).Length, createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            objectIds = ids.Select(id => id.ToString()).ToArray(), format = "3dm", version = 8, layerPolicy = "transfer-namespace", materialPolicy = "reject" });
    }
    private static OperationResultV2 Import(RhinoDoc document, JsonElement args)
    {
        if (!RhinoAgentTransaction.IsActive) throw new InvalidOperationException("Import requires an owned Rhino transaction.");
        var expectedSettings = args.GetProperty("expectedSettingsRevision").GetString();
        var settings = JsonSerializer.SerializeToElement(RhinoDocumentOperations.Instance.ReadSettings(null), RpcV2Contract.JsonOptions);
        if (settings.GetProperty("settingsRevision").GetString() != expectedSettings) throw new InvalidOperationException("Destination settings revision changed.");
        var path = args.GetProperty("path").GetString()!;
        if (!Path.IsPathFullyQualified(path) || Path.GetExtension(path) != ".3dm") throw new InvalidOperationException("Artifact import requires an absolute .3dm path.");
        var bytes = File.ReadAllBytes(path);
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
        if (args.GetProperty("checksum").GetString() != checksum) throw new InvalidOperationException("Artifact checksum changed before native import.");
        using var model = File3dm.FromByteArray(bytes) ?? throw new InvalidOperationException("Cannot read artifact .3dm.");
        var source = args.GetProperty("sourceUnits").GetString(); var destination = args.GetProperty("destinationUnits").GetString();
        if (!string.Equals(model.Settings.ModelUnitSystem.ToString(), source, StringComparison.OrdinalIgnoreCase) || !string.Equals(document.ModelUnitSystem.ToString(), destination, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Artifact or destination units changed.");
        var scale = args.GetProperty("scale").GetDouble();
        if (!double.IsFinite(scale) || scale <= 0) throw new InvalidOperationException("A positive explicit conversion factor is required.");
        if (model.Settings.ModelUnitSystem is not (UnitSystem.None or UnitSystem.CustomUnits) && document.ModelUnitSystem is not (UnitSystem.None or UnitSystem.CustomUnits))
        {
            var expected = RhinoMath.UnitScale(model.Settings.ModelUnitSystem, document.ModelUnitSystem);
            if (Math.Abs(scale - expected) > Math.Abs(expected) * 1e-12) throw new InvalidOperationException("Conversion factor does not preserve physical dimensions.");
        }
        // RhinoCommon's File3dmObjectTable ICollection.CopyTo can leave null entries
        // on macOS. Enumerate explicitly instead of LINQ's ICollection fast path.
        var objects = new List<File3dmObject>();
        foreach (var item in model.Objects) objects.Add(item);
        if (objects.Any(item => item is null || item.Geometry is null || item.Attributes is null)) throw new InvalidOperationException("Artifact object table contains missing geometry or attributes.");
        if (objects.Count == 0 || objects.Count > 10000 || objects.Any(item => !Supported(item.Geometry) || item.Attributes.MaterialIndex >= 0)) throw new InvalidOperationException("Artifact contains unsupported objects or dependencies.");
        var transform = Transform.Scale(Point3d.Origin, scale);
        var prepared = new List<(GeometryBase Geometry, ObjectAttributes Attributes)>();
        try
        {
            foreach (var item in objects)
            {
                var geometry = item.Geometry.Duplicate() ?? throw new InvalidOperationException("Native artifact geometry duplication returned no geometry.");
                if (!geometry.Transform(transform) || !geometry.IsValid) { geometry.Dispose(); throw new InvalidOperationException("Artifact geometry cannot be converted safely."); }
                prepared.Add((geometry, new ObjectAttributes { Name = item.Attributes.Name, ObjectColor = item.Attributes.ObjectColor, ColorSource = item.Attributes.ColorSource }));
            }
            var artifactId = args.GetProperty("artifactId").GetString()!;
            if (!System.Text.RegularExpressions.Regex.IsMatch(artifactId, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")) throw new InvalidOperationException("Invalid artifact identity.");
            var layer = new Layer { Name = "Hopper transfer " + artifactId + " " + Guid.NewGuid().ToString("N")[..8] };
            var imported = new List<string>();
            var provenance = new List<object>();
            string layerId = null;
            var stage = "create transfer layer";
            try
            {
                var layerIndex = document.Layers.Add(layer);
                if (layerIndex < 0) throw new InvalidOperationException("Cannot create the transfer layer namespace.");
                var transferLayer = document.Layers[layerIndex] ?? throw new InvalidOperationException("Native transfer layer was not retained after creation.");
                layerId = transferLayer.Id.ToString();
                stage = "add converted geometry";
                foreach (var item in prepared)
                {
                    item.Attributes.LayerIndex = layerIndex;
                    var id = document.Objects.Add(item.Geometry, item.Attributes);
                    if (id == Guid.Empty) return new OperationResultV2 { Class = RpcResultClass.failed, ReasonCode = RpcReasonCode.OPERATION_FAILED,
                        Message = "Import partially completed. Inspect returned destination identities before reconciliation.",
                        Data = JsonSerializer.SerializeToElement(new { ok = false, objectIds = imported, layerId }) };
                    provenance.Add(new { sourceObjectId = objects[imported.Count].Attributes.ObjectId.ToString(), destinationObjectId = id.ToString() });
                    imported.Add(id.ToString());
                }
                stage = "redraw destination";
                document.Views.Redraw();
                return DocumentSession.Result(new { ok = true, objectIds = imported, provenance, layerId, scale });
            }
            catch (Exception error)
            {
                return DocumentSession.Result(new { ok = false, outcomeUncertain = true, objectIds = imported, provenance, layerId, layerName = layer.Name,
                    error = new { code = "NATIVE_IMPORT_INTERRUPTED", message = error.Message, stage } });
            }
        }
        finally { foreach (var item in prepared) item.Geometry.Dispose(); }
    }
}
