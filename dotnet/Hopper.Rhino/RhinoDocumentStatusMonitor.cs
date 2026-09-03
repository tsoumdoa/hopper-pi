using System;
using Hopper.Core.Runtime;
using Rhino;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Owns the Rhino document event subscriptions and translates each callback
    /// into a host-free Core status value while still on Rhino's UI thread.
    /// </summary>
    internal sealed class RhinoDocumentStatusMonitor : IDisposable
    {
        private readonly IHostDocumentStatusSink _status;
        private bool _started;

        public RhinoDocumentStatusMonitor(IHostDocumentStatusSink status)
        {
            _status = status ?? throw new ArgumentNullException(nameof(status));
        }

        public void Start()
        {
            if (_started)
                return;

            _started = true;
            RhinoDoc.NewDocument += OnDocumentChanged;
            RhinoDoc.ActiveDocumentChanged += OnDocumentChanged;
            RhinoDoc.DocumentPropertiesChanged += OnDocumentChanged;
            RhinoDoc.EndOpenDocument += OnDocumentOpened;
            RhinoDoc.EndSaveDocument += OnDocumentSaved;
            RhinoDoc.CloseDocument += OnDocumentClosed;
            ReportActiveDocument();
        }

        public void Dispose()
        {
            if (!_started)
                return;

            _started = false;
            RhinoDoc.NewDocument -= OnDocumentChanged;
            RhinoDoc.ActiveDocumentChanged -= OnDocumentChanged;
            RhinoDoc.DocumentPropertiesChanged -= OnDocumentChanged;
            RhinoDoc.EndOpenDocument -= OnDocumentOpened;
            RhinoDoc.EndSaveDocument -= OnDocumentSaved;
            RhinoDoc.CloseDocument -= OnDocumentClosed;
        }

        private void OnDocumentChanged(object sender, DocumentEventArgs args) =>
            ReportActiveDocument();

        private void OnDocumentOpened(object sender, DocumentOpenEventArgs args) =>
            ReportActiveDocument();

        private void OnDocumentSaved(object sender, DocumentSaveEventArgs args) =>
            ReportActiveDocument();

        private void OnDocumentClosed(object sender, DocumentEventArgs args)
        {
            var active = RhinoDoc.ActiveDoc;
            if (active == null || active.RuntimeSerialNumber == args.DocumentSerialNumber)
            {
                Report(false, null);
                return;
            }

            Report(active);
        }

        private void ReportActiveDocument()
        {
            var active = RhinoDoc.ActiveDoc;
            if (active == null)
            {
                Report(false, null);
                return;
            }

            Report(active);
        }

        private void Report(RhinoDoc document) =>
            Report(
                true,
                string.IsNullOrWhiteSpace(document.Name) ? "Untitled" : document.Name);

        private void Report(bool active, string name) =>
            _status.Report(new HostDocumentStatusChange(
                HostDocumentKind.Rhino,
                active,
                name));
    }
}
