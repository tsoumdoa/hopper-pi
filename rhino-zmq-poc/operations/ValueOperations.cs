using System;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc
{
    public static class ValueOperations
    {
        public static string SetSliderValue(GH_Document doc, SetSliderValueParams param)
        {
            if (doc == null)
                return "setSliderValue error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setSliderValue error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setSliderValue error: object not found '{param.TargetId}'";

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

        public static string SetPanelText(GH_Document doc, SetPanelTextParams param)
        {
            if (doc == null)
                return "setPanelText error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"setPanelText error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"setPanelText error: object not found '{param.TargetId}'";

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
