using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using Grasshopper.Kernel;
using Rhino;
using rhino_zmq_poc.Protocol;

namespace rhino_zmq_poc
{
    internal sealed class DocumentIdentityService
    {
        private sealed class IdentityHolder
        {
            public string Id { get; }

            public IdentityHolder(string id)
            {
                Id = id;
            }
        }

        private readonly object _sync = new object();
        private readonly ConditionalWeakTable<object, IdentityHolder> _grasshopperIds =
            new ConditionalWeakTable<object, IdentityHolder>();
        private readonly Dictionary<uint, string> _rhinoIds = new Dictionary<uint, string>();

        public BackendIdentityDto Backend { get; }

        public DocumentIdentityService(string pluginVersion, DateTimeOffset? startedAt = null, string backendId = null)
        {
            Backend = new BackendIdentityDto
            {
                BackendId = backendId ?? NewId("be"),
                BackendStartedAt = (startedAt ?? DateTimeOffset.UtcNow).ToString("O"),
                PluginVersion = pluginVersion ?? "",
                ProtocolVersion = HopperProtocol.Version
            };
        }

        public BackendDocumentsDto GetDocuments(GH_Document grasshopper, RhinoDoc rhino)
        {
            if (grasshopper == null) return null;
            var ghPath = string.IsNullOrWhiteSpace(grasshopper.FilePath) ? null : grasshopper.FilePath;
            var ghName = ghPath == null ? "Untitled" : Path.GetFileName(ghPath);
            var documents = new BackendDocumentsDto
            {
                Grasshopper = GetGrasshopperIdentity(grasshopper, ghName, ghPath)
            };
            if (rhino != null)
            {
                var rhinoPath = string.IsNullOrWhiteSpace(rhino.Path) ? null : rhino.Path;
                documents.Rhino = GetRhinoIdentity(
                    rhino.RuntimeSerialNumber,
                    string.IsNullOrWhiteSpace(rhino.Name) ? "Untitled" : rhino.Name,
                    rhinoPath);
            }
            return documents;
        }

        internal GrasshopperDocumentIdentityDto GetGrasshopperIdentity(
            object documentKey,
            string displayName,
            string path)
        {
            if (documentKey == null) throw new ArgumentNullException(nameof(documentKey));
            var holder = _grasshopperIds.GetValue(documentKey, _ => new IdentityHolder(NewId("ghd")));
            return new GrasshopperDocumentIdentityDto
            {
                DocumentId = holder.Id,
                DisplayName = displayName ?? "Untitled",
                Path = path
            };
        }

        internal RhinoDocumentIdentityDto GetRhinoIdentity(
            uint runtimeSerialNumber,
            string displayName,
            string path)
        {
            string id;
            lock (_sync)
            {
                if (!_rhinoIds.TryGetValue(runtimeSerialNumber, out id))
                {
                    id = NewId("rhd");
                    _rhinoIds.Add(runtimeSerialNumber, id);
                }
            }
            return new RhinoDocumentIdentityDto
            {
                DocumentId = id,
                RuntimeSerialNumber = runtimeSerialNumber,
                DisplayName = displayName ?? "Untitled",
                Path = path
            };
        }

        private static string NewId(string prefix) => $"{prefix}_{Guid.NewGuid():N}";
    }
}
