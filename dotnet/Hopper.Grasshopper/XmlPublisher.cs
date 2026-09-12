using System;
using GH_IO.Serialization;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal class XmlPublisher
    {
        private readonly Action<string, string> _publish;

        public XmlPublisher(Action<string, string> publish)
        {
            _publish = publish;
        }

        public static string SerializeToXml(GH_Document doc)
        {
            if (doc == null) return null;
            var archive = new GH_Archive();
            try
            {
                archive.AppendObject(doc, "Definition");
            }
            catch (InvalidOperationException)
            {
                return null;
            }
            catch (ArgumentOutOfRangeException)
            {
                return null;
            }
            return archive.Serialize_Xml();
        }

        public string Publish(GH_Document doc)
        {
            string xml = SerializeToXml(doc);
            if (xml == null) return null;
            _publish?.Invoke(doc.FilePath ?? "Untitled.gh", xml);
            return xml;
        }
    }
}