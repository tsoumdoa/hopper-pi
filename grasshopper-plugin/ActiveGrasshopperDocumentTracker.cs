using System;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Moves solution publication to the document shown by the active canvas.
    /// Edit routing resolves the active document separately for every operation.
    /// </summary>
    internal sealed class ActiveGrasshopperDocumentTracker : IDisposable
    {
        private readonly DocumentMonitor _monitor;
        private GH_Document _lastDocument;
        private bool _started;

        public ActiveGrasshopperDocumentTracker(DocumentMonitor monitor)
        {
            _monitor = monitor ?? throw new ArgumentNullException(nameof(monitor));
        }

        public void Start()
        {
            if (_started)
                return;
            _started = true;
            RhinoApp.Idle += OnIdle;
            Refresh();
        }

        private void OnIdle(object sender, EventArgs e) => Refresh();

        private void Refresh()
        {
            if (!_started)
                return;

            var current = Grasshopper.Instances.ActiveCanvas?.Document;
            if (ReferenceEquals(current, _lastDocument))
                return;

            _lastDocument = current;
            _monitor.EnsureSubscription(current);
        }

        public void Dispose()
        {
            if (!_started)
                return;
            _started = false;
            RhinoApp.Idle -= OnIdle;
            _lastDocument = null;
        }
    }
}
