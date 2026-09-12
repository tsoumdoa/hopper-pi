using System;
using System.Threading;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    /// <summary>
    /// Owns the solution event subscription for the currently active document.
    /// </summary>
    internal sealed class DocumentMonitor : IDisposable
    {
        private GH_Document _subscribedDocument;
        private int _disposed;

        public event Action<GH_Document> Changed;

        public void EnsureSubscription(GH_Document document)
        {
            if (ReferenceEquals(_subscribedDocument, document))
                return;

            Unsubscribe();
            if (document == null || _disposed != 0)
                return;

            document.SolutionEnd += OnSolutionEnd;
            document.FilePathChanged += OnFilePathChanged;
            _subscribedDocument = document;
        }

        private void OnSolutionEnd(object sender, EventArgs args)
        {
            if (_disposed == 0 && sender is GH_Document document)
                Changed?.Invoke(document);
        }

        private void OnFilePathChanged(object sender, GH_DocFilePathEventArgs args)
        {
            if (_disposed == 0 && sender is GH_Document document)
                Changed?.Invoke(document);
        }

        private void Unsubscribe()
        {
            if (_subscribedDocument == null)
                return;

            _subscribedDocument.SolutionEnd -= OnSolutionEnd;
            _subscribedDocument.FilePathChanged -= OnFilePathChanged;
            _subscribedDocument = null;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;

            Unsubscribe();
        }
    }
}
