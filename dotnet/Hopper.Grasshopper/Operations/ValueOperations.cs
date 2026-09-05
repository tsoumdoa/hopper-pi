using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;


namespace rhino_zmq_poc
{
    internal static class ValueOperations
    {
        public static string CreateSlider(GH_Document doc, CreateSliderParams param)
        {
            if (!GraphObjectFactory.TryCreateSlider(doc, param, out var created, out var error))
                return $"createSlider error: {error}";
            return $"createSlider: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }

        public static string EditSliderRange(GH_Document doc, EditSliderRangeParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"editSliderRange error: {err}";

            if (obj is GH_NumberSlider slider)
            {
                slider.Slider.Minimum = (decimal)param.Min;
                slider.Slider.Maximum = (decimal)param.Max;
                slider.Slider.DecimalPlaces = param.Digits;
                slider.Attributes?.ExpireLayout();
                slider.OnDisplayExpired(true);
                slider.ExpireSolution(true);

                return $"editSliderRange: updated ({param.TargetId}) min={param.Min} max={param.Max} digits={param.Digits}";
            }

            return $"editSliderRange error: object '{param.TargetId}' is not a Number Slider";
        }

        public static string SetSliderValue(GH_Document doc, SetSliderValueParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setSliderValue error: {err}";

            if (obj is GH_NumberSlider slider)
            {
                slider.SetSliderValue((decimal)param.Value);
								slider.Attributes?.ExpireLayout();
								slider.OnDisplayExpired(true);
								slider.ExpireSolution(true);

                return $"setSliderValue: set ({param.TargetId}) = {param.Value}";
            }

            return $"setSliderValue error: object '{param.TargetId}' is not a Number Slider";
        }

        public static string CreatePanel(GH_Document doc, CreatePanelParams param)
        {
            if (!GraphObjectFactory.TryCreatePanel(doc, param, out var created, out var error))
                return $"createPanel error: {error}";
            return $"createPanel: created ({created.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }

        public static string SetPanelParams(GH_Document doc, SetPanelParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setPanelParams error: {err}";

            if (obj is GH_Panel panel)
            {
                var textOutputError = Utilities.TryResolvePanelMultiline(param.TextOutput, out var multiline);
                if (textOutputError != null)
                    return $"setPanelParams error: {textOutputError}";
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

                panel.Attributes?.ExpireLayout();
                panel.OnDisplayExpired(true);
                panel.ExpireSolution(true);

                return $"setPanelParams: updated properties on ({param.TargetId})";
            }

            return $"setPanelParams error: object '{param.TargetId}' is not a Panel";
        }

        public static string SetPanelText(GH_Document doc, SetPanelTextParams param)
        {
            if (!OpHelpers.TryResolveTarget(doc, param.TargetId, out var obj, out var err))
                return $"setPanelText error: {err}";

            if (obj is GH_Panel panel)
            {
                panel.UserText = param.Text;
                                panel.Attributes?.ExpireLayout();
                                panel.OnDisplayExpired(true);
                                panel.ExpireSolution(true);

                return $"setPanelText: set ({param.TargetId}) text = \"{param.Text}\"";
            }

            return $"setPanelText error: object '{param.TargetId}' is not a Panel";
        }
    }
}
