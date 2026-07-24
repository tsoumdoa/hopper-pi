using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc
{
    internal static class GraphObjectFactory
    {
        public static bool TryCreateComponent(
            GH_Document doc,
            AddComponentParams param,
            string nickName,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            if (doc == null)
            {
                error = "document is null";
                return false;
            }
            if (!Guid.TryParse(param.TypeGuid, out var componentGuid))
            {
                error = $"invalid typeGuid '{param.TypeGuid}'";
                return false;
            }

            var obj = Instances.ComponentServer.EmitObject(componentGuid);
            if (obj == null)
            {
                error = $"failed to emit object for typeGuid '{param.TypeGuid}'";
                return false;
            }

            doc.AddObject(obj, false);
            if (obj.Attributes == null)
            {
                error = "Attributes is null after AddObject()";
                return false;
            }

            obj.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
            if (!string.IsNullOrWhiteSpace(nickName))
                obj.NickName = nickName;
            if (!param.Preview)
            {
                var hiddenProp = obj.GetType().GetProperty("Hidden");
                hiddenProp?.SetValue(obj, true);
            }

            created = obj;
            return true;
        }

        public static bool TryCreateSlider(
            GH_Document doc,
            CreateSliderParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var slider = new GH_NumberSlider();
                slider.CreateAttributes();
                slider.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                slider.Slider.Minimum = (decimal)param.Min;
                slider.Slider.Maximum = (decimal)param.Max;
                slider.SetSliderValue((decimal)param.Value);
                slider.Slider.DecimalPlaces = param.Digits;
                slider.NickName = param.NickName ?? "Number Slider";
                doc.AddObject(slider, false);
                created = slider;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreatePanel(
            GH_Document doc,
            CreatePanelParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var panel = new GH_Panel();
                panel.CreateAttributes();
                panel.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                panel.UserText = param.Text;
                panel.NickName = param.NickName ?? "Panel";
                var textOutputError = Utilities.TryResolvePanelMultiline(param.TextOutput, out var multiline);
                if (textOutputError != null)
                {
                    error = textOutputError;
                    return false;
                }
                panel.Properties.Multiline = multiline;
                if (!string.IsNullOrEmpty(param.BgColor))
                    panel.Properties.Colour = Utilities.ParseRgbaColor(param.BgColor);
                if (param.Width.HasValue || param.Height.HasValue)
                {
                    var bounds = panel.Attributes.Bounds;
                    if (param.Width.HasValue) bounds.Width = (float)param.Width.Value;
                    if (param.Height.HasValue) bounds.Height = (float)param.Height.Value;
                    panel.Attributes.Bounds = bounds;
                }
                doc.AddObject(panel, false);
                created = panel;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateToggle(
            GH_Document doc,
            CreateToggleParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var toggle = new GH_BooleanToggle();
                toggle.CreateAttributes();
                toggle.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                toggle.NickName = param.NickName ?? "Toggle";
                toggle.Value = param.Value;
                doc.AddObject(toggle, false);
                created = toggle;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateSwatch(
            GH_Document doc,
            CreateSwatchParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var swatch = new GH_ColourSwatch();
                swatch.CreateAttributes();
                swatch.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                swatch.NickName = param.NickName ?? "Colour Swatch";
                swatch.SwatchColour = Utilities.ParseRgbaColor(param.Color);
                doc.AddObject(swatch, false);
                created = swatch;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateScribble(
            GH_Document doc,
            CreateScribbleParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var scribble = new GH_Scribble();
                scribble.CreateAttributes();
                scribble.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                scribble.Text = param.Text;
                scribble.NickName = param.NickName ?? "Scribble";
                scribble.Font = new Font(new FontFamily("Arial"), (float)(param.Size ?? 10f), FontStyle.Regular);
                doc.AddObject(scribble, false);
                created = scribble;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateValueList(
            GH_Document doc,
            CreateValueListParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var valueList = new GH_ValueList();
                valueList.CreateAttributes();
                valueList.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                valueList.NickName = param.NickName ?? "Value List";
                valueList.ListItems.Clear();
                if (param.Items != null)
                {
                    foreach (var item in param.Items)
                        valueList.ListItems.Add(new GH_ValueListItem(item.Name, item.Value));
                }
                if (param.SelectedIndex.HasValue &&
                    param.SelectedIndex.Value >= 0 &&
                    param.SelectedIndex.Value < valueList.ListItems.Count)
                {
                    valueList.ListItems[param.SelectedIndex.Value].Selected = true;
                }
                doc.AddObject(valueList, false);
                created = valueList;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateScript(
            GH_Document doc,
            CreateScriptNodeParams param,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var reflector = GhScriptReflector.Get();
                var guid = reflector.ResolveLanguageGuid(param.Language);
                if (guid == Guid.Empty)
                {
                    error = $"unknown language '{param.Language}'";
                    return false;
                }
                var obj = Instances.ComponentServer.EmitObject(guid);
                if (obj == null)
                {
                    error = $"failed to emit script component for language '{param.Language}'";
                    return false;
                }
                doc.AddObject(obj, false);
                if (obj.Attributes == null)
                {
                    error = "Attributes is null after AddObject()";
                    return false;
                }
                obj.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                var hiddenProp = obj.GetType().GetProperty("Hidden");
                hiddenProp?.SetValue(obj, true);

                if (obj is GH_Component comp)
                {
                    ComponentLifecycleOps.ClearAllParams(comp);
                    foreach (var input in param.Inputs ?? new List<ScriptIOParam>())
                    {
                        ComponentLifecycleOps.AddScriptInputParam(
                            comp, input.Name, access: input.Access, dataMapping: input.DataMapping,
                            simplify: input.Simplify, reverse: input.Reverse, typeHint: input.TypeHint);
                    }
                    foreach (var output in param.Outputs ?? new List<ScriptIOParam>())
                    {
                        ComponentLifecycleOps.AddScriptOutputParam(
                            comp, output.Name, dataMapping: output.DataMapping,
                            simplify: output.Simplify, reverse: output.Reverse, typeHint: output.TypeHint);
                    }
                }
                if (!string.IsNullOrWhiteSpace(param.Code))
                    reflector.SetSource(obj, param.Code);
                obj.NickName = !string.IsNullOrWhiteSpace(param.NickName)
                    ? param.NickName
                    : param.Language == "python" ? "Py3" : "C#";
                obj.ExpireSolution(false);
                created = obj;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }

        public static bool TryCreateGroup(
            GH_Document doc,
            string name,
            IEnumerable<IGH_DocumentObject> members,
            string color,
            string border,
            out IGH_DocumentObject created,
            out string error)
        {
            created = null;
            error = null;
            try
            {
                var group = new GH_Group
                {
                    NickName = name,
                    Colour = Utilities.ParseRgbaColor(color, Color.FromArgb(150, 255, 255, 255))
                };
                if (!string.IsNullOrEmpty(border))
                    group.Border = Utilities.ParseGroupBorder(border, group.Border);
                foreach (var member in members)
                    group.AddObject(member.InstanceGuid);
                doc.AddObject(group, false);
                created = group;
                return true;
            }
            catch (Exception ex)
            {
                error = $"{ex.GetType().Name}: {ex.Message}";
                return false;
            }
        }
    }
}
