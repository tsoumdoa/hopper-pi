using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Grasshopper.Kernel.Special;


namespace rhino_zmq_poc
{
    public static class SpecialOperations
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
                return $"createToggle CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SetToggleValue(GH_Document doc, SetToggleValueParams param)
        {
            if (doc == null)
                return "setToggleValue error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setToggleValue error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setToggleValue error: object not found '{param.TargetId}'";

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
                return $"createSwatch CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SetSwatchColor(GH_Document doc, SetSwatchColorParams param)
        {
            if (doc == null)
                return "setSwatchColor error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setSwatchColor error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setSwatchColor error: object not found '{param.TargetId}'";

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
                return $"createScribble CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SetScribbleText(GH_Document doc, SetScribbleTextParams param)
        {
            if (doc == null)
                return "setScribbleText error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setScribbleText error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setScribbleText error: object not found '{param.TargetId}'";

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
                return $"createValueList CRASH: {ex.GetType().Name} - {ex.Message}\n{ex.StackTrace}";
            }
        }

        public static string SetValueListSelected(GH_Document doc, SetValueListSelectedParams param)
        {
            if (doc == null)
                return "setValueListSelected error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setValueListSelected error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setValueListSelected error: object not found '{param.TargetId}'";

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
