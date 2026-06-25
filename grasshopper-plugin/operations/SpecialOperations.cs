using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Grasshopper.Kernel.Special;


namespace rhino_zmq_poc
{
    internal static class SpecialOperations
    {
        public static string CreateToggle(GH_Document doc, CreateToggleParams param)
        {
            if (doc == null)
                return "createToggle error: document is null";

            try
            {
                var toggle = new GH_BooleanToggle();
                toggle.CreateAttributes();
                toggle.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                toggle.NickName = param.NickName ?? "Toggle";
                toggle.Value = param.Value;

                doc.AddObject(toggle, false);

                return $"createToggle: created ({toggle.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) value={param.Value}";
            }
            catch (Exception ex)
            {
                return $"createToggle error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string SetToggleValue(GH_Document doc, SetToggleValueParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setToggleValue error: {err}";

            if (obj is GH_BooleanToggle toggle)
            {
                toggle.Value = param.Value;
                toggle.Attributes?.ExpireLayout();
                toggle.OnDisplayExpired(true);
                toggle.ExpireSolution(true);

                return $"setToggleValue: set ({param.TargetId}) = {param.Value}";
            }

            return $"setToggleValue error: object '{param.TargetId}' is not a Boolean Toggle";
        }

        public static string CreateSwatch(GH_Document doc, CreateSwatchParams param)
        {
            if (doc == null)
                return "createSwatch error: document is null";

            try
            {
                var swatch = new GH_ColourSwatch();
                swatch.CreateAttributes();
                swatch.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                swatch.NickName = param.NickName ?? "Colour Swatch";
                swatch.SwatchColour = Utilities.ParseRgbaColor(param.Color);
                doc.AddObject(swatch, false);

                return $"createSwatch: created ({swatch.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) color={param.Color}";
            }
            catch (Exception ex)
            {
                return $"createSwatch error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string SetSwatchColor(GH_Document doc, SetSwatchColorParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setSwatchColor error: {err}";

            if (obj is GH_ColourSwatch swatch)
            {
                swatch.SwatchColour = Utilities.ParseRgbaColor(param.Color);
                swatch.Attributes?.ExpireLayout();
                swatch.OnDisplayExpired(true);
                swatch.ExpireSolution(true);

                return $"setSwatchColor: set ({param.TargetId}) color = {param.Color}";
            }

            return $"setSwatchColor error: object '{param.TargetId}' is not a Colour Swatch";
        }

        public static string CreateScribble(GH_Document doc, CreateScribbleParams param)
        {
            if (doc == null)
                return "createScribble error: document is null";

            try
            {
                var scribble = new GH_Scribble();
                scribble.CreateAttributes();
                scribble.Attributes.Pivot = new PointF((float)param.Position.X, (float)param.Position.Y);
                scribble.Text = param.Text;
                scribble.NickName = param.NickName ?? "Scribble";

                var style = FontStyle.Regular;
                scribble.Font = new Font(new FontFamily("Arial"), (float)(param.Size ?? 10f), style);

                doc.AddObject(scribble, false);

                return $"createScribble: created ({scribble.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
            }
            catch (Exception ex)
            {
                return $"createScribble error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string SetScribbleText(GH_Document doc, SetScribbleTextParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setScribbleText error: {err}";

            if (obj is GH_Scribble scribble)
            {
                scribble.Text = param.Text;
                scribble.Attributes?.ExpireLayout();
                scribble.OnDisplayExpired(true);
                scribble.ExpireSolution(true);

                return $"setScribbleText: set ({param.TargetId}) text = \"{param.Text}\"";
            }

            return $"setScribbleText error: object '{param.TargetId}' is not a Scribble";
        }

        public static string CreateValueList(GH_Document doc, CreateValueListParams param)
        {
            if (doc == null)
                return "createValueList error: document is null";

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

                if (param.SelectedIndex.HasValue && param.SelectedIndex.Value >= 0 && param.SelectedIndex.Value < valueList.ListItems.Count)
                    valueList.ListItems[param.SelectedIndex.Value].Selected = true;

                doc.AddObject(valueList, false);

                return $"createValueList: created ({valueList.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) with {valueList.ListItems.Count} items";
            }
            catch (Exception ex)
            {
                return $"createValueList error: {ex.GetType().Name}: {ex.Message}";
            }
        }

        public static string SetValueListSelected(GH_Document doc, SetValueListSelectedParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setValueListSelected error: {err}";

            if (obj is GH_ValueList valueList)
            {
                if (param.SelectedIndex < 0 || param.SelectedIndex >= valueList.ListItems.Count)
                    return $"setValueListSelected error: index {param.SelectedIndex} out of range [0..{valueList.ListItems.Count - 1}]";

                valueList.ListItems[param.SelectedIndex].Selected = true;
                valueList.Attributes?.ExpireLayout();
                valueList.OnDisplayExpired(true);
                valueList.ExpireSolution(true);

                return $"setValueListSelected: set ({param.TargetId}) selectedIndex = {param.SelectedIndex}";
            }

            return $"setValueListSelected error: object '{param.TargetId}' is not a Value List";
        }
    }
}
