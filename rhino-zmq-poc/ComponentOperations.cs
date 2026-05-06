using System;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class ComponentOperations
    {
        public static string AddComponentToCanvas(GH_Document doc, AddComponentParams param)
        {
            if (doc == null)
                return "addComponent error: document is null";

            if (!Guid.TryParse(param.Guid, out var componentGuid))
                return $"addComponent error: invalid guid '{param.Guid}'";

            IGH_DocumentObject obj = Instances.ComponentServer.EmitObject(componentGuid);
            if (obj == null)
                return $"addComponent error: failed to emit object for guid '{param.Guid}'";

            obj.Attributes.Pivot = new System.Drawing.PointF(
                (float)param.Position.X,
                (float)param.Position.Y);

            doc.AddObject(obj, false);
            doc.NewSolution(true);

            return $"addComponent: added ({obj.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }
    }
}
