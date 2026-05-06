using System;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public class DocumentMonitor : IDisposable
    {
        private GH_Document _subscribedDoc;

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
            OnSolutionEnd?.Invoke(sender as GH_Document);
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
            Unsubscribe();
        }
    }
}