using System;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Tracks the active canvas and owns all document subscriptions for the adapter.
    /// </summary>
    internal sealed class ActiveGrasshopperDocumentTracker : IDisposable
    {
        private readonly DocumentMonitor _monitor = new DocumentMonitor();
        private GH_Document _activeDocument;
        private bool _started;

        public GH_Document ActiveDocument => _activeDocument;

        public void Start()
        {
            if (_started)
                return;

            _started = true;
            RhinoApp.Idle += OnIdle;
            Refresh();
        }

        private void OnIdle(object sender, EventArgs args) => Refresh();

        private void Refresh()
        {
            if (!_started)
                return;

            var current = Grasshopper.Instances.ActiveCanvas?.Document;
            if (ReferenceEquals(current, _activeDocument))
                return;

            _activeDocument = current;
            _monitor.EnsureSubscription(current);
        }

        public void Dispose()
        {
            if (!_started)
                return;

            _started = false;
            RhinoApp.Idle -= OnIdle;
            _monitor.Dispose();
            _activeDocument = null;
        }
    }
}
