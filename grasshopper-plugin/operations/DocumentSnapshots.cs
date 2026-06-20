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

            if (obj is rhino_zmq_pocComponent)
                return true;

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

        public static void Apply(GH_Document target, byte[] snapshot)
        {
            if (target == null)
                throw new ArgumentNullException(nameof(target));
            if (snapshot == null || snapshot.Length == 0)
                throw new ArgumentException("Snapshot is empty", nameof(snapshot));

            var archive = new GH_Archive();
            archive.Deserialize_Binary(snapshot);

            var incoming = new GH_Document();
            if (!archive.ExtractObject(incoming, ArchiveKey))
                throw new InvalidOperationException("Failed to extract document from snapshot");

            RemoveNonInfrastructure(target);
            PrepareIncomingForMerge(target, incoming);

            if (incoming.ObjectCount > 0)
            {
                // Move objects (and their internal wire graph) from the snapshot document.
                // Per-object RemoveObject/AddObject breaks IGH_Param source links.
                target.MergeDocument(incoming, resolveProxies: true);
            }

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
