using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;

namespace rhino_zmq_poc
{
    internal sealed class GetDataHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root) =>
            Utilities.RunOnUiThread(() => DataInspection.Read(doc, root), TimeSpan.FromSeconds(5));
    }

    internal static class DataInspection
    {
        private sealed class Revision { public string Value = Guid.NewGuid().ToString("N"); public void Change() => Value = Guid.NewGuid().ToString("N"); }
        // Weak keys keep closed documents and deleted components collectible.
        private static readonly ConditionalWeakTable<GH_Document, Revision> Documents = new();
        private static readonly ConditionalWeakTable<IGH_DocumentObject, Revision> Targets = new();

        internal static string Read(GH_Document doc, JsonElement root)
        {
            bool continuation = root.TryGetProperty("cursor", out var cursor);
            if (continuation)
                foreach (var property in root.EnumerateObject())
                    if (property.Name is not ("cursor" or "limit"))
                        throw new ArgumentException("Use cursor alone with optional limit.");
            var request = continuation
                ? DataInspectionPage.ReadCursor(cursor.GetString())
                : JsonSerializer.Deserialize<InspectionRequest>(root.GetRawText(), DataInspectionPage.JsonOptions);
            int limit = root.TryGetProperty("limit", out var limitValue) ? limitValue.GetInt32() : 20;
            if (request == null || !Guid.TryParse(request.TargetId, out var id)) throw new ArgumentException("Invalid targetId.");
            if (request.Mode is not ("summary" or "branches" or "items")) throw new ArgumentException("Unknown inspection mode.");
            if (request.Side is not ("both" or "input" or "output")) throw new ArgumentException("Unknown side.");
            if (request.Offset < 0 || request.BranchIndex < 0) throw new ArgumentException("Invalid offset or branchIndex.");
            if (request.Mode != "items" && request.BranchIndex != null)
                throw new ArgumentException("branchIndex is only valid for items.");

            var target = doc.FindObject(id, false) ?? throw new ArgumentException("Target not found in the active Grasshopper document.");
            var owner = target.Attributes?.GetTopLevel.DocObject ?? target;
            var active = owner as IGH_ActiveObject;
            var documentRevision = Documents.GetValue(doc, document =>
            {
                var revision = new Revision();
                document.SolutionStart += (_, _) => revision.Change();
                document.SolutionEnd += (_, _) => revision.Change();
                document.ObjectsAdded += (_, _) => revision.Change();
                document.ObjectsDeleted += (_, _) => revision.Change();
                return revision;
            });
            var targetRevision = Targets.GetValue(owner, obj =>
            {
                var revision = new Revision();
                obj.SolutionExpired += (_, _) => revision.Change();
                obj.ObjectChanged += (_, _) => revision.Change();
                return revision;
            });
            if (continuation) DataInspectionPage.ValidateRevision(request, documentRevision.Value, targetRevision.Value);
            request = request with { TargetId = id.ToString(), DocumentRevision = documentRevision.Value, TargetRevision = targetRevision.Value };

            var response = new Dictionary<string, object>
            {
                ["solutionState"] = doc.SolutionState.ToString(),
                ["phase"] = active?.Phase.ToString() ?? "unknown",
                ["locked"] = active?.Locked ?? false,
                ["solverEnabled"] = GH_Document.EnableSolutions && doc.Enabled,
            };
            int total;
            Func<int, object> readRow;
            if (request.Mode == "summary")
            {
                if (target is IGH_Component component)
                {
                    int inputs = request.Side == "output" ? 0 : component.Params.Input.Count;
                    int outputs = request.Side == "input" ? 0 : component.Params.Output.Count;
                    total = inputs + outputs;
                    readRow = index => index < inputs
                        ? Port(component.Params.Input[index], "input", index)
                        : Port(component.Params.Output[index - inputs], "output", index - inputs);
                }
                else if (target is IGH_Param parameter)
                {
                    total = 1;
                    string side = parameter.Kind == GH_ParamKind.input ? "input" : parameter.Kind == GH_ParamKind.output ? "output" : "parameter";
                    int index = owner is IGH_Component parent
                        ? (side == "input" ? parent.Params.Input : parent.Params.Output).IndexOf(parameter)
                        : 0;
                    readRow = _ => Port(parameter, side, index);
                }
                else throw new ArgumentException("Target must be a component or parameter.");
            }
            else
            {
                if (target is not IGH_Param parameter) throw new ArgumentException("Use a port ID from summary for branches or items.");
                var data = parameter.VolatileData;
                if (request.Mode == "branches")
                {
                    total = data.PathCount;
                    readRow = index =>
                    {
                        string path = data.get_Path(index).ToString();
                        return new { branchIndex = index, path = Clip(path), totalItems = data.get_Branch(index)?.Count ?? 0, truncated = path.Length > TextLimit };
                    };
                }
                else
                {
                    int branchIndex = request.BranchIndex ?? throw new ArgumentException("items requires branchIndex.");
                    if (branchIndex >= data.PathCount) throw new ArgumentException("Branch index not found.");
                    var branch = data.get_Branch(branchIndex);
                    total = branch?.Count ?? 0;
                    response["branchIndex"] = branchIndex;
                    var pathText = data.get_Path(branchIndex).ToString();
                    response["path"] = Clip(pathText);
                    response["pathTruncated"] = pathText.Length > TextLimit;
                    readRow = index => Item(branch[index], index);
                }
            }
            var result = DataInspectionPage.Build(request, total, limit, response, readRow);
            DataInspectionPage.ValidateRevision(request, documentRevision.Value, targetRevision.Value);
            return result;
        }

        private const int TextLimit = 256;
        private static string Clip(string text) => text == null || text.Length <= TextLimit ? text : text.Substring(0, TextLimit);

        private static object Port(IGH_Param parameter, string side, int index) => new
        {
            portId = parameter.InstanceGuid.ToString(), name = Clip(parameter.Name), side, index,
            dataType = Clip(parameter.TypeName), access = parameter.Access.ToString(), phase = parameter.Phase.ToString(),
            totalBranches = parameter.VolatileData.PathCount, totalItems = parameter.VolatileDataCount,
            truncated = parameter.Name.Length > TextLimit || parameter.TypeName.Length > TextLimit,
        };

        private static object Number(double value) => double.IsFinite(value) ? value : value.ToString(CultureInfo.InvariantCulture);
        private static object Coordinates(double x, double y, double z) => new { x = Number(x), y = Number(y), z = Number(z) };

        private static object Item(object item, int index)
        {
            var row = new Dictionary<string, object> { ["index"] = index, ["type"] = Clip(item?.GetType().Name ?? "null") };
            if (item == null) { row["value"] = null; return row; }
            // Unknown goo can execute arbitrary formatting/validation on the UI thread.
            // A byte limit applied after those calls would not bound their allocations.
            if (item.GetType().Assembly != typeof(GH_Number).Assembly)
                return Omitted(row);
            if (item is GH_ObjectWrapper wrapper)
            {
                object wrapped = wrapper.Value;
                row["wrappedType"] = Clip(wrapped?.GetType().FullName ?? "null");
                switch (wrapped)
                {
                    case null: row["value"] = null; break;
                    case string text: row["value"] = Clip(text); row["truncated"] = text.Length > TextLimit; break;
                    case bool or byte or sbyte or short or ushort or int or uint or long or ulong or decimal:
                        row["value"] = wrapped; break;
                    case double number: row["value"] = Number(number); break;
                    case float number: row["value"] = Number(number); break;
                    default: return Omitted(row);
                }
                return row;
            }
            try
            {
                object value;
                switch (item)
                {
                    case GH_Number number: value = Number(number.Value); break;
                    case GH_Integer integer: value = integer.Value; break;
                    case GH_Boolean boolean: value = boolean.Value; break;
                    case GH_String text: value = text.Value; break;
                    case GH_Point point: value = Coordinates(point.Value.X, point.Value.Y, point.Value.Z); break;
                    case GH_Vector vector: value = Coordinates(vector.Value.X, vector.Value.Y, vector.Value.Z); break;
                    default: return Omitted(row);
                }
                if (value is string description)
                {
                    row["truncated"] = description.Length > TextLimit;
                    value = Clip(description);
                }
                row["value"] = value;
            }
            catch (Exception ex) { row["error"] = Clip(ex.Message); }
            return row;
        }

        private static object Omitted(Dictionary<string, object> row)
        {
            row["summary"] = true;
            row["omitted"] = "unsupported_type";
            return row;
        }
    }
}
