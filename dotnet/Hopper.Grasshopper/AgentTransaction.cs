using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class AgentTransaction
    {
        private static readonly BoundTransactionState<GH_Document, byte[]> State =
            new BoundTransactionState<GH_Document, byte[]>();
        private static string _transactionName;

        public static bool IsActive => State.IsActive;

        public static string Begin(GH_Document doc, string name = "Hopper agent")
        {
            if (doc == null)
                return "beginAgentTransaction error: document is null";

            if (State.IsActive)
            {
                if (State.IsBoundTo(doc))
                    return "beginAgentTransaction: transaction already active";
                CancelActive();
            }

            var snapshot = DocumentSnapshots.Serialize(doc);
            if (snapshot == null)
                return "beginAgentTransaction error: failed to snapshot document";

            State.Begin(doc, snapshot);
            _transactionName = string.IsNullOrWhiteSpace(name) ? "Hopper agent" : name;
            return "beginAgentTransaction: started";
        }

        public static string Commit(GH_Document doc)
        {
            if (!State.IsBoundTo(doc))
                return "commitAgentTransaction: no active transaction";

            try
            {
                return State.Complete((boundDocument, beforeSnapshot) =>
                {
                    var afterSnapshot = DocumentSnapshots.Serialize(boundDocument);
                    if (afterSnapshot == null)
                        return "commitAgentTransaction error: failed to snapshot document";

                    if (DocumentSnapshots.AreEqual(beforeSnapshot, afterSnapshot))
                        return "commitAgentTransaction: no canvas changes";

                    var action = new DocumentSnapshotUndoAction(beforeSnapshot, afterSnapshot);
                    boundDocument.UndoUtil.RecordEvent(_transactionName, action);
                    return "commitAgentTransaction: recorded undo";
                });
            }
            finally
            {
                _transactionName = null;
            }
        }

        public static string Cancel(GH_Document doc)
        {
            if (!State.IsBoundTo(doc))
                return "cancelAgentTransaction: no active transaction";

            return CancelActive();
        }

        public static string CancelActive()
        {
            if (!State.IsActive)
                return "cancelAgentTransaction: no active transaction";

            try
            {
                return State.Complete((document, beforeSnapshot) =>
                {
                    DocumentSnapshots.Apply(document, beforeSnapshot);
                    return "cancelAgentTransaction: reverted canvas";
                });
            }
            finally
            {
                _transactionName = null;
            }
        }
    }
}
