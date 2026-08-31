using System;
using System.Collections.Generic;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal static class DocumentSnapshots
    {
        private const string ArchiveKey = "Definition";

        /// <summary>GHZMQ component type guid (rhino-zmq-pocComponent).</summary>
        private static readonly Guid GhzmqComponentTypeId =
            new Guid("e07753b1-fdec-417a-b57a-83a95204a8dd");

        /// <summary>
        /// Infrastructure components must not be removed during undo restore; RemoveObject
        /// on GHZMQ disposes ZMQ sockets and drops the Pi connection.
        /// </summary>
        public static bool IsInfrastructure(IGH_DocumentObject obj)
        {
            if (obj == null)
                return false;

            if (obj is GH_Component component && component.ComponentGuid == GhzmqComponentTypeId)
                return true;

            var typeName = obj.GetType().FullName ?? string.Empty;
            return typeName.EndsWith(".rhino_zmq_pocComponent", StringComparison.Ordinal);
        }

        public static byte[] Serialize(GH_Document doc)
        {
            if (doc == null) return null;

            var archive = new GH_Archive();
            try
            {
                if (!archive.AppendObject(doc, ArchiveKey))
                    return null;
                return archive.Serialize_Binary();
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static bool AreEqual(byte[] left, byte[] right)
        {
            if (ReferenceEquals(left, right)) return true;
            if (left == null || right == null) return false;
            if (left.Length != right.Length) return false;
            for (int i = 0; i < left.Length; i++)
            {
                if (left[i] != right[i])
                    return false;
            }
            return true;
        }

        /// <summary>
        /// Restores <paramref name="target"/> to the canvas captured in
        /// <paramref name="snapshot"/>. Failure-safe: the replacement document is
        /// fully deserialized and validated BEFORE the live canvas is mutated, and a
        /// fallback snapshot of the current target is captured so a mid-merge failure
        /// restores the original instead of leaving the canvas empty/corrupted.
        /// </summary>
        public static void Apply(GH_Document target, byte[] snapshot)
        {
            if (target == null)
                throw new ArgumentNullException(nameof(target));
            if (snapshot == null || snapshot.Length == 0)
                throw new ArgumentException("Snapshot is empty", nameof(snapshot));

            // 1. Build the replacement document fully, before touching the target.
            //    Any deserialization/extraction failure throws here and leaves the
            //    live canvas completely intact.
            var incoming = ExtractDocument(snapshot);

            // 2. Capture the current target state so the destructive swap below can
            //    be rolled back if it fails partway. If we cannot capture a fallback
            //    we still proceed; the merge operates on already-validated data, and
            //    the more common failure mode (bad snapshot) is already excluded.
            var fallback = TrySerialize(target);

            try
            {
                Swap(target, incoming);
            }
            catch (Exception)
            {
                // Removal and/or merge failed after mutating the target. Best-effort
                // restore the original canvas from the fallback so we never leave the
                // target empty or half-merged; the original exception then propagates.
                if (fallback != null)
                {
                    try { Swap(target, ExtractDocument(fallback)); }
                    catch { /* last resort; the original exception is rethrown below */ }
                }
                throw;
            }
        }

        /// <summary>Deserializes a snapshot into a fresh document, or throws if invalid.</summary>
        private static GH_Document ExtractDocument(byte[] snapshot)
        {
            var archive = new GH_Archive();
            if (!archive.Deserialize_Binary(snapshot))
                throw new InvalidOperationException("Failed to deserialize snapshot");

            var doc = new GH_Document();
            if (!archive.ExtractObject(doc, ArchiveKey))
                throw new InvalidOperationException("Failed to extract document from snapshot");
            return doc;
        }

        private static byte[] TrySerialize(GH_Document doc)
        {
            try { return Serialize(doc); }
            catch { return null; }
        }

        /// <summary>
        /// Destructive swap: clears non-infrastructure objects from the target and
        /// moves the snapshot's objects (with their internal wire graph) onto it.
        /// Per-object RemoveObject/AddObject breaks IGH_Param source links, so the
        /// whole incoming document is merged at once.
        /// </summary>
        private static void Swap(GH_Document target, GH_Document incoming)
        {
            RemoveNonInfrastructure(target);
            PrepareIncomingForMerge(target, incoming);

            if (incoming.ObjectCount > 0)
                target.MergeDocument(incoming, resolveProxies: true);

            target.NewSolution(true);
        }

        private static void RemoveNonInfrastructure(GH_Document doc)
        {
            foreach (var obj in doc.Objects.ToList())
            {
                if (IsInfrastructure(obj))
                    continue;
                doc.RemoveObject(obj, true);
            }
        }

        /// <summary>
        /// Drop GHZMQ clones and any object whose InstanceGuid already lives on the target
        /// (the live GHZMQ instance is kept on the target document).
        /// </summary>
        private static void PrepareIncomingForMerge(GH_Document target, GH_Document incoming)
        {
            var onTarget = new HashSet<Guid>(target.Objects.Select(o => o.InstanceGuid));

            foreach (var obj in incoming.Objects.ToList())
            {
                if (IsInfrastructure(obj) || onTarget.Contains(obj.InstanceGuid))
                    incoming.RemoveObject(obj, true);
            }
        }
    }
}
