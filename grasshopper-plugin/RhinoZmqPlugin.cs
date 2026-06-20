using System;

namespace rhino_zmq_poc
{
    internal class RhinoZmqPlugin
    {
        private static RhinoZmqPlugin _instance = new RhinoZmqPlugin();
        public static RhinoZmqPlugin Instance
        {
            get => _instance;
            set => _instance = value;
        }

        public rhino_zmq_pocComponent Component { get; set; }
    }
}