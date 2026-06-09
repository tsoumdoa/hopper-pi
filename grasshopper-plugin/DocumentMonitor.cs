using System;
using System.Threading;
using Grasshopper;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    public class DocumentMonitor : IDisposable
    {
        private GH_Document _subscribedDoc;
        private int _disposed;

        public event Action<GH_Document> OnSolutionEnd;

        public void EnsureSubscription(GH_Document doc)
        {
            var current = doc;
            if (current == null) return;
            if (_subscribedDoc != current)
            {
                Unsubscribe();
                current.SolutionEnd += OnSolutionEndHandler;
                _subscribedDoc = current;
            }
        }

        private void OnSolutionEndHandler(object sender, EventArgs e)
        {
            if (_disposed != 0) return;
            var doc = sender as GH_Document;

            Utilities.RunOnUiThread(() =>
            {
                if (_disposed == 0)
                    OnSolutionEnd?.Invoke(doc);
            });
        }

        public void Unsubscribe()
        {
            if (_subscribedDoc != null)
            {
                _subscribedDoc.SolutionEnd -= OnSolutionEndHandler;
                _subscribedDoc = null;
            }
        }

        public void Dispose()
        {
            Interlocked.Exchange(ref _disposed, 1);
            Unsubscribe();
        }
    }
}