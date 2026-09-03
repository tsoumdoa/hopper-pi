using System;
using Grasshopper;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Hopper.Core.Runtime;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Tracks the active canvas and owns all document subscriptions for the adapter.
    /// </summary>
    internal sealed class ActiveGrasshopperDocumentTracker : IDisposable
    {
        private readonly DocumentMonitor _monitor = new DocumentMonitor();
        private readonly IHostDocumentStatusSink _status;
        private GH_Canvas _canvas;
        private GH_Document _activeDocument;
        private bool _started;

        public ActiveGrasshopperDocumentTracker(IHostDocumentStatusSink status)
        {
            _status = status ?? throw new ArgumentNullException(nameof(status));
            _monitor.Changed += OnTrackedDocumentChanged;
        }

        public GH_Document ActiveDocument => _activeDocument;

        public void Start()
        {
            if (_started)
                return;

            _started = true;
            Instances.CanvasCreated += OnCanvasCreated;
            Instances.CanvasDestroyed += OnCanvasDestroyed;
            AttachCanvas(Instances.ActiveCanvas);
        }

        private void OnCanvasCreated(GH_Canvas canvas) => AttachCanvas(canvas);

        private void OnCanvasDestroyed(GH_Canvas canvas)
        {
            if (!ReferenceEquals(canvas, _canvas))
                return;

            DetachCanvas();
            SetDocument(null);
        }

        private void AttachCanvas(GH_Canvas canvas)
        {
            if (ReferenceEquals(canvas, _canvas))
            {
                SetDocument(canvas?.Document);
                return;
            }

            DetachCanvas();
            _canvas = canvas;
            if (_canvas != null)
                _canvas.DocumentChanged += OnCanvasDocumentChanged;
            SetDocument(_canvas?.Document);
        }

        private void DetachCanvas()
        {
            if (_canvas == null)
                return;

            _canvas.DocumentChanged -= OnCanvasDocumentChanged;
            _canvas = null;
        }

        private void OnCanvasDocumentChanged(
            GH_Canvas canvas,
            GH_CanvasDocumentChangedEventArgs args)
        {
            if (ReferenceEquals(canvas, _canvas))
                SetDocument(args.NewDocument);
        }

        private void SetDocument(GH_Document document)
        {
            if (!ReferenceEquals(document, _activeDocument))
            {
                _activeDocument = document;
                _monitor.EnsureSubscription(document);
            }
            Report(document);
        }

        private void OnTrackedDocumentChanged(GH_Document document)
        {
            if (ReferenceEquals(document, _activeDocument))
                Report(document);
        }

        private void Report(GH_Document document) =>
            _status.Report(new HostDocumentStatusChange(
                HostDocumentKind.Grasshopper,
                document != null,
                document == null
                    ? null
                    : string.IsNullOrWhiteSpace(document.FilePath)
                        ? "Untitled"
                        : document.FilePath));

        public void Dispose()
        {
            if (!_started)
                return;

            _started = false;
            Instances.CanvasCreated -= OnCanvasCreated;
            Instances.CanvasDestroyed -= OnCanvasDestroyed;
            DetachCanvas();
            _monitor.Dispose();
            _activeDocument = null;
            Report(null);
        }
    }
}
