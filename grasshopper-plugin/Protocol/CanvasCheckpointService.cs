using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace rhino_zmq_poc.Protocol
{
    internal sealed class CanvasCheckpointService
    {
        public const int DefaultMaxCheckpointBytes = 64 * 1024 * 1024;

        private readonly int _maxCheckpointBytes;

        public CanvasCheckpointService(int maxCheckpointBytes = DefaultMaxCheckpointBytes)
        {
            _maxCheckpointBytes = maxCheckpointBytes > 0 ? maxCheckpointBytes : DefaultMaxCheckpointBytes;
        }

        public CanvasCheckpointEnvelopeDto Capture(
            GH_Document document,
            BackendIdentityDto backend,
            GrasshopperDocumentIdentityDto identity)
        {
            if (document == null)
                throw new HopperRequestException("document_conflict", "No Grasshopper document is active.");
            if (backend == null || string.IsNullOrEmpty(backend.BackendId))
                throw new HopperRequestException("backend_conflict", "Backend identity is unavailable.");
            if (identity == null || string.IsNullOrEmpty(identity.DocumentId))
                throw new HopperRequestException("document_conflict", "Grasshopper document identity is unavailable.");

            var bytes = DocumentSnapshots.Serialize(document)
                ?? throw new HopperRequestException("operation_failed", "Could not serialize the Grasshopper document.");
            if (bytes.Length > _maxCheckpointBytes)
                throw new HopperRequestException("invalid_input", "The captured canvas exceeds the checkpoint size limit.");

            var canvas = BuildCanonicalCanvas(document);
            return new CanvasCheckpointEnvelopeDto
            {
                SchemaVersion = 1,
                CheckpointId = "cp_" + Guid.NewGuid().ToString("N"),
                BackendId = backend.BackendId,
                GrasshopperDocumentId = identity.DocumentId,
                CapturedAt = DateTimeOffset.UtcNow.ToString("O"),
                Encoding = "base64",
                Compression = "none",
                Bytes = Convert.ToBase64String(bytes),
                ByteLength = bytes.Length,
                BinarySha256 = CanvasCanonical.Sha256(bytes),
                CanvasDigest = CanvasCanonical.Digest(canvas),
                CanonicalCanvas = canvas,
            };
        }

        public RestoreCheckpointDataDto CompareAndRestore(
            GH_Document document,
            CanvasCheckpointEnvelopeDto checkpoint,
            string expectedLiveCanvasDigest,
            string transactionName)
        {
            if (document == null)
                throw new HopperRequestException("document_conflict", "No Grasshopper document is active.");

            var bytes = CanvasCanonical.DecodeAndValidate(checkpoint, _maxCheckpointBytes);
            var liveDigest = ComputeCanvasDigest(document);
            if (!string.Equals(liveDigest, expectedLiveCanvasDigest, StringComparison.Ordinal))
            {
                throw new HopperRequestException(
                    "canvas_conflict",
                    "The live canvas digest does not match the expected digest; another edit may have landed.");
            }

            var before = DocumentSnapshots.Serialize(document)
                ?? throw new HopperRequestException("operation_failed", "Could not snapshot the live canvas before restore.");

            DocumentSnapshots.Apply(document, bytes);
            document.NewSolution(true);

            var currentDigest = ComputeCanvasDigest(document);
            if (!string.Equals(currentDigest, checkpoint.CanvasDigest, StringComparison.Ordinal))
            {
                try { DocumentSnapshots.Apply(document, before); }
                catch { /* original exception below */ }
                throw new HopperRequestException(
                    "canvas_conflict",
                    "Post-restore canvas digest did not match the checkpoint.");
            }

            var after = DocumentSnapshots.Serialize(document) ?? bytes;
            var recorded = false;
            if (!DocumentSnapshots.AreEqual(before, after))
            {
                var name = string.IsNullOrWhiteSpace(transactionName) ? "Hopper restore" : transactionName;
                document.UndoUtil.RecordEvent(name, new DocumentSnapshotUndoAction(before, after));
                recorded = true;
            }

            return new RestoreCheckpointDataDto
            {
                RestoredCheckpointId = checkpoint.CheckpointId,
                PreviousCanvasDigest = liveDigest,
                CurrentCanvasDigest = currentDigest,
                GrasshopperUndoRecorded = recorded,
            };
        }

        public string ComputeCanvasDigest(GH_Document document)
        {
            return CanvasCanonical.Digest(BuildCanonicalCanvas(document));
        }

        internal static CanonicalCanvasDto BuildCanonicalCanvas(GH_Document document)
        {
            var canvas = new CanonicalCanvasDto();
            if (document == null) return canvas;

            foreach (var obj in document.Objects)
            {
                if (obj == null || DocumentSnapshots.IsInfrastructure(obj)) continue;
                if (obj is GH_Group group)
                {
                    canvas.Groups.Add(new CanonicalGroupDto
                    {
                        Id = group.InstanceGuid.ToString("D").ToLowerInvariant(),
                        Name = group.NickName ?? "",
                        MemberIds = group.Objects()
                            .Select(member => member.InstanceGuid.ToString("D").ToLowerInvariant())
                            .ToList(),
                        Properties = new Dictionary<string, JsonElement>(),
                    });
                    continue;
                }

                var pivot = obj.Attributes?.Pivot ?? default;
                canvas.Objects.Add(new CanonicalCanvasObjectDto
                {
                    Id = obj.InstanceGuid.ToString("D").ToLowerInvariant(),
                    TypeId = obj.ComponentGuid.ToString("D").ToLowerInvariant(),
                    Kind = obj.GetType().Name,
                    Name = obj.NickName ?? "",
                    X = Round(pivot.X),
                    Y = Round(pivot.Y),
                    Properties = PersistentProperties(obj),
                });

                CollectWires(obj, canvas.Wires);
            }

            return CanvasCanonical.Sort(canvas);
        }

        private static void CollectWires(IGH_DocumentObject obj, List<CanonicalWireDto> wires)
        {
            if (obj is IGH_Component component)
            {
                foreach (var input in component.Params.Input)
                    CollectParamWires(input, wires);
                return;
            }

            if (obj is IGH_Param param)
                CollectParamWires(param, wires);
        }

        private static void CollectParamWires(IGH_Param input, List<CanonicalWireDto> wires)
        {
            if (input?.Sources == null) return;
            foreach (var source in input.Sources)
            {
                if (source == null) continue;
                wires.Add(new CanonicalWireDto
                {
                    FromObjectId = (source.Attributes?.GetTopLevel?.DocObject?.InstanceGuid
                        ?? source.InstanceGuid).ToString("D").ToLowerInvariant(),
                    FromPort = source.Name ?? "",
                    ToObjectId = (input.Attributes?.GetTopLevel?.DocObject?.InstanceGuid
                        ?? input.InstanceGuid).ToString("D").ToLowerInvariant(),
                    ToPort = input.Name ?? "",
                });
            }
        }

        private static Dictionary<string, JsonElement> PersistentProperties(IGH_DocumentObject obj)
        {
            var properties = new Dictionary<string, JsonElement>();
            if (obj is GH_ActiveObject active && active.Locked)
                properties["locked"] = JsonSerializer.SerializeToElement(true);
            if (obj is IGH_PreviewObject preview && preview.Hidden)
                properties["hidden"] = JsonSerializer.SerializeToElement(true);
            return properties;
        }

        private static double Round(float value) =>
            Math.Round(value, 4, MidpointRounding.AwayFromZero);
    }
}
