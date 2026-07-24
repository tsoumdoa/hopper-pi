using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class GraphOperations
    {
        private static readonly Regex RefPattern =
            new Regex("^[A-Za-z][A-Za-z0-9_-]{0,31}$", RegexOptions.CultureInvariant);

        private static ApplyGraphStructuralError Error(string path, string code, string message) =>
            new ApplyGraphStructuralError { Path = path, Code = code, Message = message };

        private static bool TryTupleEndpoint(
            JsonElement tuple,
            out string reference,
            out JsonElement port,
            out string error)
        {
            reference = null;
            port = default;
            error = null;
            if (tuple.ValueKind != JsonValueKind.Array || tuple.GetArrayLength() != 2)
            {
                error = "endpoint must be [ref, port]";
                return false;
            }
            reference = tuple[0].GetString();
            port = tuple[1];
            if (string.IsNullOrWhiteSpace(reference))
            {
                error = "endpoint ref is required";
                return false;
            }
            if (port.ValueKind != JsonValueKind.String && port.ValueKind != JsonValueKind.Number)
            {
                error = "port must be a name or zero-based index";
                return false;
            }
            return true;
        }

        internal static List<ApplyGraphStructuralError> Validate(ApplyGraphRequest request)
        {
            var errors = new List<ApplyGraphStructuralError>();
            if (request == null)
            {
                errors.Add(Error("$", "INVALID_REQUEST", "Request is required."));
                return errors;
            }

            request.Components ??= new List<ApplyGraphComponentSpec>();
            request.Widgets ??= new List<ApplyGraphWidgetSpec>();
            request.Scripts ??= new List<ApplyGraphScriptSpec>();
            request.Wires ??= new List<ApplyGraphWireSpec>();
            request.Groups ??= new List<ApplyGraphGroupSpec>();

            var refs = new HashSet<string>(StringComparer.Ordinal);
            void ValidateNode(string reference, double x, double y, string path)
            {
                if (string.IsNullOrWhiteSpace(reference) || !RefPattern.IsMatch(reference))
                    errors.Add(Error($"{path}.ref", "INVALID_REF",
                        "Ref must be 1-32 letters, digits, '_' or '-', starting with a letter."));
                else if (!refs.Add(reference))
                    errors.Add(Error($"{path}.ref", "DUPLICATE_REF", $"Duplicate graph ref '{reference}'."));
                if (!double.IsFinite(x) || !double.IsFinite(y) || x < 20 || y < 20)
                    errors.Add(Error(path, "INVALID_POSITION", "Node x and y must be finite and at least 20."));
            }

            for (var i = 0; i < request.Components.Count; i++)
            {
                var spec = request.Components[i];
                if (spec == null)
                {
                    errors.Add(Error($"components[{i}]", "INVALID_COMPONENT", "Component is required."));
                    continue;
                }
                ValidateNode(spec.Ref, spec.X, spec.Y, $"components[{i}]");
                if (!Guid.TryParse(spec.TypeGuid, out _))
                    errors.Add(Error($"components[{i}].typeGuid", "INVALID_TYPE", "A full component type GUID is required."));
            }

            var widgetKinds = new HashSet<string>(
                new[] { "slider", "panel", "toggle", "swatch", "scribble", "valueList" },
                StringComparer.Ordinal);
            for (var i = 0; i < request.Widgets.Count; i++)
            {
                var spec = request.Widgets[i];
                if (spec == null)
                {
                    errors.Add(Error($"widgets[{i}]", "INVALID_WIDGET", "Widget is required."));
                    continue;
                }
                ValidateNode(spec.Ref, spec.X, spec.Y, $"widgets[{i}]");
                if (!widgetKinds.Contains(spec.Kind ?? ""))
                    errors.Add(Error($"widgets[{i}].kind", "INVALID_WIDGET", $"Unknown widget kind '{spec.Kind}'."));
                if (spec.Kind == "slider" &&
                    (spec.Value.ValueKind != JsonValueKind.Number ||
                     !double.IsFinite(spec.Min) ||
                     !double.IsFinite(spec.Max) ||
                     spec.Min > spec.Max))
                    errors.Add(Error($"widgets[{i}]", "INVALID_WIDGET",
                        "Slider requires a numeric value and min must not exceed max."));
                if (spec.Kind == "slider" &&
                    spec.Digits.HasValue &&
                    (spec.Digits.Value < 0 || spec.Digits.Value > 12))
                    errors.Add(Error($"widgets[{i}].digits", "INVALID_WIDGET",
                        "Slider digits must be from 0 through 12."));
                if (spec.Kind == "toggle" &&
                    spec.Value.ValueKind != JsonValueKind.True &&
                    spec.Value.ValueKind != JsonValueKind.False)
                    errors.Add(Error($"widgets[{i}].value", "INVALID_WIDGET", "Toggle value must be boolean."));
                if (spec.Kind == "valueList" && (spec.Items == null || spec.Items.Count == 0))
                    errors.Add(Error($"widgets[{i}].items", "INVALID_WIDGET", "Value list requires at least one item."));
                if (spec.Kind == "valueList" &&
                    spec.SelectedIndex.HasValue &&
                    (spec.SelectedIndex.Value < 0 || spec.Items == null || spec.SelectedIndex.Value >= spec.Items.Count))
                    errors.Add(Error($"widgets[{i}].selectedIndex", "INVALID_WIDGET",
                        "Value-list selectedIndex is outside its items."));
                if (spec.Kind == "panel" &&
                    spec.TextOutput != null &&
                    spec.TextOutput != "singleString" &&
                    spec.TextOutput != "oneItemPerLine")
                    errors.Add(Error($"widgets[{i}].textOutput", "INVALID_WIDGET",
                        "Panel textOutput must be singleString or oneItemPerLine."));
            }

            for (var i = 0; i < request.Scripts.Count; i++)
            {
                var spec = request.Scripts[i];
                if (spec == null)
                {
                    errors.Add(Error($"scripts[{i}]", "INVALID_SCRIPT", "Script is required."));
                    continue;
                }
                ValidateNode(spec.Ref, spec.X, spec.Y, $"scripts[{i}]");
                if (spec.Language != "csharp" && spec.Language != "python")
                    errors.Add(Error($"scripts[{i}].language", "INVALID_SCRIPT", "Language must be csharp or python."));
                if (string.IsNullOrWhiteSpace(spec.Code))
                    errors.Add(Error($"scripts[{i}].code", "INVALID_SCRIPT", "Script code is required."));
                ValidateScriptPorts(spec.Inputs, $"scripts[{i}].inputs", errors);
                ValidateScriptPorts(spec.Outputs, $"scripts[{i}].outputs", errors);
            }

            if (refs.Count == 0)
                errors.Add(Error("$", "EMPTY_GRAPH", "At least one component, widget, or script is required."));

            for (var i = 0; i < request.Wires.Count; i++)
            {
                var spec = request.Wires[i];
                if (spec == null)
                {
                    errors.Add(Error($"wires[{i}]", "INVALID_ENDPOINT", "Wire is required."));
                    continue;
                }
                if (!TryTupleEndpoint(spec.FromTuple, out var fromRef, out _, out var fromError))
                    errors.Add(Error($"wires[{i}].from", "INVALID_ENDPOINT", fromError));
                else if (!refs.Contains(fromRef))
                    errors.Add(Error($"wires[{i}].from", "UNKNOWN_REF", $"Unknown source ref '{fromRef}'."));
                if (!TryTupleEndpoint(spec.ToTuple, out var toRef, out _, out var toError))
                    errors.Add(Error($"wires[{i}].to", "INVALID_ENDPOINT", toError));
                else if (!refs.Contains(toRef))
                    errors.Add(Error($"wires[{i}].to", "UNKNOWN_REF", $"Unknown target ref '{toRef}'."));
            }

            for (var i = 0; i < request.Groups.Count; i++)
            {
                var spec = request.Groups[i];
                if (spec == null || string.IsNullOrWhiteSpace(spec.Name))
                {
                    errors.Add(Error($"groups[{i}].name", "INVALID_GROUP", "Group name is required."));
                    continue;
                }
                if (spec.Refs == null || spec.Refs.Count == 0)
                    errors.Add(Error($"groups[{i}].refs", "INVALID_GROUP", "Group requires at least one ref."));
                if (spec.Border != null &&
                    spec.Border != "Box" &&
                    spec.Border != "Blob" &&
                    spec.Border != "Rectangles")
                    errors.Add(Error($"groups[{i}].border", "INVALID_GROUP",
                        "Group border must be Box, Blob, or Rectangles."));
                foreach (var reference in spec.Refs ?? new List<string>())
                {
                    if (!refs.Contains(reference))
                        errors.Add(Error($"groups[{i}].refs", "UNKNOWN_REF", $"Unknown group ref '{reference}'."));
                }
            }

            return errors;
        }

        private static void ValidateScriptPorts(
            List<ScriptIOParam> ports,
            string path,
            List<ApplyGraphStructuralError> errors)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < (ports?.Count ?? 0); i++)
            {
                var name = ports[i]?.Name;
                if (string.IsNullOrWhiteSpace(name))
                    errors.Add(Error($"{path}[{i}].name", "INVALID_SCRIPT_PORT", "Script port name is required."));
                else if (!names.Add(name))
                    errors.Add(Error($"{path}[{i}].name", "INVALID_SCRIPT_PORT",
                        $"Duplicate script port name '{name}'."));
            }
        }

        private static ApplyGraphResponse Failure(
            Stopwatch timer,
            ApplyGraphCounts counts,
            Dictionary<string, IGH_DocumentObject> refs,
            IEnumerable<ApplyGraphStructuralError> errors,
            bool rolledBack)
        {
            timer.Stop();
            return new ApplyGraphResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Ok = false,
                RolledBack = rolledBack,
                Counts = counts,
                Refs = refs.ToDictionary(pair => pair.Key, pair => pair.Value.InstanceGuid.ToString()),
                StructuralErrors = errors.ToList(),
                ElapsedMs = timer.ElapsedMilliseconds
            };
        }

        public static ApplyGraphResponse Apply(GH_Document doc, ApplyGraphRequest request)
        {
            var timer = Stopwatch.StartNew();
            var counts = new ApplyGraphCounts();
            var refs = new Dictionary<string, IGH_DocumentObject>(StringComparer.Ordinal);
            if (doc == null)
                return Failure(timer, counts, refs,
                    new[] { Error("$", "NO_DOCUMENT", "Grasshopper document is null.") }, false);

            var validationErrors = Validate(request);
            if (validationErrors.Count > 0)
                return Failure(timer, counts, refs, validationErrors, false);

            var snapshot = DocumentSnapshots.Serialize(doc);
            if (snapshot == null)
                return Failure(timer, counts, refs,
                    new[] { Error("$", "SNAPSHOT_FAILED", "Could not snapshot the document.") }, false);

            ApplyGraphResponse Rollback(string path, string code, string message)
            {
                var rolledBack = false;
                try
                {
                    DocumentSnapshots.Apply(doc, snapshot);
                    rolledBack = true;
                }
                catch
                {
                }
                return Failure(
                    timer,
                    new ApplyGraphCounts(),
                    new Dictionary<string, IGH_DocumentObject>(),
                    new[] { Error(path, code, message) },
                    rolledBack);
            }

            bool Register(string reference, IGH_DocumentObject obj, string path, out ApplyGraphResponse failure)
            {
                failure = null;
                if (string.IsNullOrWhiteSpace(reference))
                {
                    failure = Rollback(path, "INVALID_REF", "Graph ref is required.");
                    return false;
                }
                if (refs.ContainsKey(reference))
                {
                    failure = Rollback(path, "DUPLICATE_REF", $"Duplicate graph ref '{reference}'.");
                    return false;
                }
                refs[reference] = obj;
                return true;
            }

            try
            {
                for (var i = 0; i < request.Components.Count; i++)
                {
                    var spec = request.Components[i];
                    if (!GraphObjectFactory.TryCreateComponent(
                        doc,
                        new AddComponentParams
                        {
                            TypeGuid = spec.TypeGuid,
                            Position = new Position { X = spec.X, Y = spec.Y },
                            Preview = spec.Preview
                        },
                        spec.Name,
                        out var created,
                        out var error))
                    {
                        return Rollback($"components[{i}]", "CREATE_FAILED", error);
                    }
                    if (!Register(spec.Ref, created, $"components[{i}].ref", out var failure))
                        return failure;
                    counts.Components++;
                }

                for (var i = 0; i < request.Widgets.Count; i++)
                {
                    var spec = request.Widgets[i];
                    IGH_DocumentObject created;
                    string error;
                    var position = new Position { X = spec.X, Y = spec.Y };
                    var ok = spec.Kind switch
                    {
                        "slider" => GraphObjectFactory.TryCreateSlider(doc, new CreateSliderParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Min = spec.Min,
                            Max = spec.Max,
                            Value = spec.Value.GetDouble(),
                            Digits = spec.Digits ?? 2
                        }, out created, out error),
                        "panel" => GraphObjectFactory.TryCreatePanel(doc, new CreatePanelParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Text = spec.Text ?? "",
                            TextOutput = spec.TextOutput ?? "singleString",
                            Width = spec.Width,
                            Height = spec.Height,
                            BgColor = spec.BgColor
                        }, out created, out error),
                        "toggle" => GraphObjectFactory.TryCreateToggle(doc, new CreateToggleParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Value = spec.Value.GetBoolean()
                        }, out created, out error),
                        "swatch" => GraphObjectFactory.TryCreateSwatch(doc, new CreateSwatchParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Color = spec.Color
                        }, out created, out error),
                        "scribble" => GraphObjectFactory.TryCreateScribble(doc, new CreateScribbleParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Text = spec.Text ?? "",
                            Size = spec.Size
                        }, out created, out error),
                        "valueList" => GraphObjectFactory.TryCreateValueList(doc, new CreateValueListParams
                        {
                            Position = position,
                            NickName = spec.Name,
                            Items = spec.Items?.ToArray(),
                            SelectedIndex = spec.SelectedIndex
                        }, out created, out error),
                        _ => FailUnknownWidget(out created, out error, spec.Kind)
                    };
                    if (!ok)
                        return Rollback($"widgets[{i}]", "CREATE_FAILED", error);
                    if (!Register(spec.Ref, created, $"widgets[{i}].ref", out var failure))
                        return failure;
                    counts.Widgets++;
                }

                for (var i = 0; i < request.Scripts.Count; i++)
                {
                    var spec = request.Scripts[i];
                    if (!GraphObjectFactory.TryCreateScript(doc, new CreateScriptNodeParams
                    {
                        Position = new Position { X = spec.X, Y = spec.Y },
                        Language = spec.Language,
                        Code = spec.Code,
                        NickName = spec.Name,
                        Inputs = spec.Inputs,
                        Outputs = spec.Outputs
                    }, out var created, out var error))
                    {
                        return Rollback($"scripts[{i}]", "CREATE_FAILED", error);
                    }
                    if (!Register(spec.Ref, created, $"scripts[{i}].ref", out var failure))
                        return failure;
                    counts.Scripts++;
                }

                for (var i = 0; i < request.Wires.Count; i++)
                {
                    var wire = request.Wires[i];
                    if (!TryTupleEndpoint(wire.FromTuple, out var fromRef, out var fromPort, out var fromError))
                        return Rollback($"wires[{i}].from", "INVALID_ENDPOINT", fromError);
                    if (!TryTupleEndpoint(wire.ToTuple, out var toRef, out var toPort, out var toError))
                        return Rollback($"wires[{i}].to", "INVALID_ENDPOINT", toError);
                    if (!refs.TryGetValue(fromRef, out var source))
                        return Rollback($"wires[{i}].from", "UNKNOWN_REF", $"Unknown source ref '{fromRef}'.");
                    if (!refs.TryGetValue(toRef, out var target))
                        return Rollback($"wires[{i}].to", "UNKNOWN_REF", $"Unknown target ref '{toRef}'.");
                    if (!WireOperations.TryConnectBySelector(source, fromPort, target, toPort, out var wireError))
                        return Rollback($"wires[{i}]", "WIRE_FAILED", wireError);
                    counts.Wires++;
                }

                for (var i = 0; i < request.Groups.Count; i++)
                {
                    var spec = request.Groups[i];
                    var members = new List<IGH_DocumentObject>();
                    foreach (var reference in spec.Refs ?? new List<string>())
                    {
                        if (!refs.TryGetValue(reference, out var member))
                            return Rollback($"groups[{i}].refs", "UNKNOWN_REF", $"Unknown group ref '{reference}'.");
                        members.Add(member);
                    }
                    if (!GraphObjectFactory.TryCreateGroup(
                        doc, spec.Name, members, spec.Color, spec.Border,
                        out _, out var error))
                    {
                        return Rollback($"groups[{i}]", "GROUP_FAILED", error);
                    }
                    counts.Groups++;
                }

                doc.NewSolution(false);
                timer.Stop();
                return new ApplyGraphResponse
                {
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Ok = true,
                    RolledBack = false,
                    Counts = counts,
                    Refs = refs.ToDictionary(pair => pair.Key, pair => pair.Value.InstanceGuid.ToString()),
                    ElapsedMs = timer.ElapsedMilliseconds
                };
            }
            catch (Exception ex)
            {
                return Rollback("$", "APPLY_FAILED", $"{ex.GetType().Name}: {ex.Message}");
            }
        }

        private static bool FailUnknownWidget(
            out IGH_DocumentObject created,
            out string error,
            string kind)
        {
            created = null;
            error = $"unknown widget kind '{kind}'";
            return false;
        }
    }
}
