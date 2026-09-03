using Grasshopper.Kernel;
using Grasshopper.Kernel.Undo;

namespace rhino_zmq_poc
{
    internal sealed class DocumentSnapshotUndoAction : GH_UndoAction
    {
        private readonly byte[] _undoBytes;
        private readonly byte[] _redoBytes;

        public DocumentSnapshotUndoAction(byte[] undoBytes, byte[] redoBytes)
        {
            _undoBytes = undoBytes;
            _redoBytes = redoBytes;
        }

        public override bool ExpiresSolution => true;

        public override bool ExpiresDisplay => true;

        protected override void Internal_Undo(GH_Document doc)
        {
            DocumentSnapshots.Apply(doc, _undoBytes);
        }

        protected override void Internal_Redo(GH_Document doc)
        {
            DocumentSnapshots.Apply(doc, _redoBytes);
        }
    }
}
