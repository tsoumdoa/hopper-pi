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
            if (!GraphObjectFactory.TryCreateToggle(doc, param, out var created, out var error))
                return CommandOperationException.Fail($"createToggle error: {error}");
            return $"createToggle: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) value={param.Value}";
        }

        public static string SetToggleValue(GH_Document doc, SetToggleValueParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setToggleValue error: {err}");

            if (obj is GH_BooleanToggle toggle)
            {
                toggle.Value = param.Value;
                toggle.Attributes?.ExpireLayout();
                toggle.OnDisplayExpired(true);
                toggle.ExpireSolution(true);

                return $"setToggleValue: set ({param.TargetId}) = {param.Value}";
            }

            return CommandOperationException.Fail($"setToggleValue error: object '{param.TargetId}' is not a Boolean Toggle");
        }

        public static string CreateSwatch(GH_Document doc, CreateSwatchParams param)
        {
            if (!GraphObjectFactory.TryCreateSwatch(doc, param, out var created, out var error))
                return CommandOperationException.Fail($"createSwatch error: {error}");
            return $"createSwatch: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) color={param.Color}";
        }

        public static string SetSwatchColor(GH_Document doc, SetSwatchColorParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setSwatchColor error: {err}");

            if (obj is GH_ColourSwatch swatch)
            {
                swatch.SwatchColour = Utilities.ParseRgbaColor(param.Color);
                swatch.Attributes?.ExpireLayout();
                swatch.OnDisplayExpired(true);
                swatch.ExpireSolution(true);

                return $"setSwatchColor: set ({param.TargetId}) color = {param.Color}";
            }

            return CommandOperationException.Fail($"setSwatchColor error: object '{param.TargetId}' is not a Colour Swatch");
        }

        public static string CreateScribble(GH_Document doc, CreateScribbleParams param)
        {
            if (!GraphObjectFactory.TryCreateScribble(doc, param, out var created, out var error))
                return CommandOperationException.Fail($"createScribble error: {error}");
            return $"createScribble: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }

        public static string SetScribbleText(GH_Document doc, SetScribbleTextParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setScribbleText error: {err}");

            if (obj is GH_Scribble scribble)
            {
                scribble.Text = param.Text;
                scribble.Attributes?.ExpireLayout();
                scribble.OnDisplayExpired(true);
                scribble.ExpireSolution(true);

                return $"setScribbleText: set ({param.TargetId}) text = \"{param.Text}\"";
            }

            return CommandOperationException.Fail($"setScribbleText error: object '{param.TargetId}' is not a Scribble");
        }

        public static string CreateValueList(GH_Document doc, CreateValueListParams param)
        {
            if (!GraphObjectFactory.TryCreateValueList(doc, param, out var created, out var error))
                return CommandOperationException.Fail($"createValueList error: {error}");
            var count = created is GH_ValueList valueList ? valueList.ListItems.Count : 0;
            return $"createValueList: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y}) with {count} items";
        }

        public static string SetValueListSelected(GH_Document doc, SetValueListSelectedParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return CommandOperationException.Fail($"setValueListSelected error: {err}");

            if (obj is GH_ValueList valueList)
            {
                if (param.SelectedIndex < 0 || param.SelectedIndex >= valueList.ListItems.Count)
                    return CommandOperationException.Fail($"setValueListSelected error: index {param.SelectedIndex} out of range [0..{valueList.ListItems.Count - 1}]");

                valueList.ListItems[param.SelectedIndex].Selected = true;
                valueList.Attributes?.ExpireLayout();
                valueList.OnDisplayExpired(true);
                valueList.ExpireSolution(true);

                return $"setValueListSelected: set ({param.TargetId}) selectedIndex = {param.SelectedIndex}";
            }

            return CommandOperationException.Fail($"setValueListSelected error: object '{param.TargetId}' is not a Value List");
        }
    }
}
