using System;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class ComponentLifecycleOps
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

            return $"addComponent: added ({obj.InstanceGuid}) at ({param.Position.X}, {param.Position.Y})";
        }

        public static string DeleteComponent(GH_Document doc, DeleteComponentParams param)
        {
            if (doc == null)
                return "deleteComponent error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"deleteComponent error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"deleteComponent error: object not found '{param.TargetId}'";

            doc.RemoveObject(obj, false);

            return $"deleteComponent: removed ({param.TargetId})";
        }

        public static string MoveComponent(GH_Document doc, MoveComponentParams param)
        {
            if (doc == null)
                return "moveComponent error: document is null";

            if (!Guid.TryParse(param.TargetId, out var targetGuid))
                return $"moveComponent error: invalid targetId '{param.TargetId}'";

            IGH_DocumentObject obj = doc.FindObject(targetGuid, false);
            if (obj == null)
                return $"moveComponent error: object not found '{param.TargetId}'";

            obj.Attributes.Pivot = new System.Drawing.PointF(
                (float)param.Position.X,
                (float)param.Position.Y);


            return $"moveComponent: moved ({param.TargetId}) to ({param.Position.X}, {param.Position.Y})";
        }
    }
}
