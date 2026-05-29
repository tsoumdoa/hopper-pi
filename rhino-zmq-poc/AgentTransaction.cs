using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public static class AgentTransaction
    {
        private static GH_Document _doc;
        private static byte[] _beforeSnapshot;
        private static string _transactionName;
        private static bool _active;

        public static bool IsActive => _active;

        public static string Begin(GH_Document doc, string name = "Hopper agent")
        {
            if (doc == null)
                return "beginAgentTransaction error: document is null";

            if (_active)
            {
                if (_doc == doc)
                    return "beginAgentTransaction: transaction already active";
                Cancel(_doc);
            }

            var snapshot = DocumentSnapshots.Serialize(doc);
            if (snapshot == null)
                return "beginAgentTransaction error: failed to snapshot document";

            _doc = doc;
            _beforeSnapshot = snapshot;
            _transactionName = string.IsNullOrWhiteSpace(name) ? "Hopper agent" : name;
            _active = true;
            return "beginAgentTransaction: started";
        }

        public static string Commit(GH_Document doc)
        {
            if (!_active || _doc != doc)
                return "commitAgentTransaction: no active transaction";

            try
            {
                var afterSnapshot = DocumentSnapshots.Serialize(doc);
                if (afterSnapshot == null)
                    return "commitAgentTransaction error: failed to snapshot document";

                if (DocumentSnapshots.AreEqual(_beforeSnapshot, afterSnapshot))
                    return "commitAgentTransaction: no canvas changes";

                var action = new DocumentSnapshotUndoAction(_beforeSnapshot, afterSnapshot);
                doc.UndoUtil.RecordEvent(_transactionName, action);
                return "commitAgentTransaction: recorded undo";
            }
            finally
            {
                Reset();
            }
        }

        public static string Cancel(GH_Document doc)
        {
            if (!_active || _doc != doc)
                return "cancelAgentTransaction: no active transaction";

            try
            {
                if (_beforeSnapshot != null)
                    DocumentSnapshots.Apply(doc, _beforeSnapshot);
                return "cancelAgentTransaction: reverted canvas";
            }
            finally
            {
                Reset();
            }
        }

        private static void Reset()
        {
            _active = false;
            _doc = null;
            _beforeSnapshot = null;
            _transactionName = null;
        }
    }
}
