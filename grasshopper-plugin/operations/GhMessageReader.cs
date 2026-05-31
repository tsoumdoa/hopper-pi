using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class GhMessageReader
    {
        public static List<CanvasError> GetAllWarningsAndErrors(GH_Document doc)
        {
            var results = new List<CanvasError>();

            if (doc == null) return results;

            foreach (IGH_DocumentObject obj in doc.Objects)
            {
                if (obj == null) continue;

                var activeObj = obj as GH_ActiveObject;
                if (activeObj == null) continue;

                foreach (string warning in activeObj.RuntimeMessages(GH_RuntimeMessageLevel.Warning))
                {
                    results.Add(new CanvasError
                    {
                        ComponentId = obj.InstanceGuid.ToString(),
                        ComponentNickName = obj.NickName ?? "",
                        Level = "warning",
                        Text = warning
                    });
                }

                foreach (string error in activeObj.RuntimeMessages(GH_RuntimeMessageLevel.Error))
                {
                    results.Add(new CanvasError
                    {
                        ComponentId = obj.InstanceGuid.ToString(),
                        ComponentNickName = obj.NickName ?? "",
                        Level = "error",
                        Text = error
                    });
                }
            }

            return results;
        }
    }
}