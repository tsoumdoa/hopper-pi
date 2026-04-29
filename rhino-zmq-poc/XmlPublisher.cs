using System;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public class XmlPublisher
    {
        private readonly Action<string, string> _publish;

        public XmlPublisher(Action<string, string> publish)
        {
            _publish = publish;
        }

        public string Publish(GH_Document doc)
        {
            if (doc == null) return null;

            var archive = new GH_IO.Serialization.GH_Archive();
            archive.AppendObject(doc, "Definition");
            string xml = archive.Serialize_Xml();
            _publish?.Invoke(doc.FilePath ?? "Untitled.gh", xml);
            return xml;
        }
    }
}