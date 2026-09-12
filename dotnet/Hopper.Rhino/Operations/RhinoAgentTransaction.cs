using Rhino;

namespace rhino_zmq_poc
{
    internal static class RhinoAgentTransaction
    {
        private static RhinoDoc _doc;
        private static uint _undoSerial;
        private static bool _active;

        public static bool IsActive => _active;
        public static string BoundDocumentId => _active && _doc != null ? $"{Hopper.Core.Operations.DocumentSession.LifecycleInstanceId}:rhino:{_doc.RuntimeSerialNumber}" : null;

        public static string Begin(RhinoDoc doc, string name = "Hopper agent")
        {
            if (doc == null)
                return "beginRhinoAgentTransaction error: document is null";

            if (_active)
            {
                if (_doc == doc)
                    return "beginRhinoAgentTransaction: transaction already active";
                throw new System.InvalidOperationException("Cannot begin a transaction while another document owns the undo record.");
            }

            var recordName = string.IsNullOrWhiteSpace(name) ? "Hopper agent" : name;
            var enabledBefore = doc.UndoRecordingEnabled;
            var recordingBefore = doc.UndoRecordingIsActive;
            _undoSerial = doc.BeginUndoRecord(recordName);
            if (_undoSerial == 0)
                return $"beginRhinoAgentTransaction error: could not start undo record (undo disabled or already recording); document={doc.RuntimeSerialNumber}; undoEnabledBefore={enabledBefore}; undoRecordingBefore={recordingBefore}; undoRecordingAfter={doc.UndoRecordingIsActive}; hopperActive={_active}; undoSerial={_undoSerial}";

            _doc = doc;
            _active = true;
            return "beginRhinoAgentTransaction: started";
        }

        public static string Commit(RhinoDoc doc)
        {
            if (!_active || _doc != doc)
                return "commitRhinoAgentTransaction: no active transaction";

            CloseOwnedRecord(doc);
            return "commitRhinoAgentTransaction: recorded undo";
        }

        public static string CommitActive() => Commit(_doc);

        public static string Cancel(RhinoDoc doc)
        {
            if (!_active || _doc != doc)
                return "cancelRhinoAgentTransaction: no active transaction";

            CloseOwnedRecord(doc);
            return "cancelRhinoAgentTransaction: closed";
        }

        public static string CancelActive() => Cancel(_doc);

        private static void CloseOwnedRecord(RhinoDoc doc)
        {
            // Never forget ownership after a rejected or throwing native close.
            if (_undoSerial == 0 || !doc.EndUndoRecord(_undoSerial))
                throw new System.InvalidOperationException($"Could not close Hopper undo record; document={doc.RuntimeSerialNumber}; undoSerial={_undoSerial}; undoEnabled={doc.UndoRecordingEnabled}; undoRecording={doc.UndoRecordingIsActive}");
            Reset();
        }

        private static void Reset()
        {
            _active = false;
            _doc = null;
            _undoSerial = 0;
        }
    }
}
