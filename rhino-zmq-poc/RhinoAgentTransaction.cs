using Rhino;

namespace rhino_zmq_poc
{
    public static class RhinoAgentTransaction
    {
        private static RhinoDoc _doc;
        private static uint _undoSerial;
        private static bool _active;

        public static bool IsActive => _active;

        public static string Begin(RhinoDoc doc, string name = "Hopper agent")
        {
            if (doc == null)
                return "beginRhinoAgentTransaction error: document is null";

            if (_active)
            {
                if (_doc == doc)
                    return "beginRhinoAgentTransaction: transaction already active";
                Cancel(_doc);
            }

            var recordName = string.IsNullOrWhiteSpace(name) ? "Hopper agent" : name;
            _undoSerial = doc.BeginUndoRecord(recordName);
            if (_undoSerial == 0)
                return "beginRhinoAgentTransaction error: could not start undo record (undo disabled or already recording)";

            _doc = doc;
            _active = true;
            return "beginRhinoAgentTransaction: started";
        }

        public static string Commit(RhinoDoc doc)
        {
            if (!_active || _doc != doc)
                return "commitRhinoAgentTransaction: no active transaction";

            try
            {
                if (_undoSerial != 0)
                    doc.EndUndoRecord(_undoSerial);
                return "commitRhinoAgentTransaction: recorded undo";
            }
            finally
            {
                Reset();
            }
        }

        public static string Cancel(RhinoDoc doc)
        {
            if (!_active || _doc != doc)
                return "cancelRhinoAgentTransaction: no active transaction";

            try
            {
                if (_undoSerial != 0)
                {
                    doc.EndUndoRecord(_undoSerial);
                    doc.Undo();
                }
                return "cancelRhinoAgentTransaction: reverted";
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
            _undoSerial = 0;
        }
    }
}
