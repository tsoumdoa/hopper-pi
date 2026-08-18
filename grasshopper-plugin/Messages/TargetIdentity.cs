using System;
using System.Text.Json.Serialization;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    internal class DocumentTarget
    {
        [JsonPropertyName("backendInstanceId")]
        public string BackendInstanceId { get; set; }

        [JsonPropertyName("ghDocument")]
        public GrasshopperDocumentTarget GhDocument { get; set; }

        [JsonPropertyName("rhinoDocument")]
        public RhinoDocumentTarget RhinoDocument { get; set; }
    }

    internal class GrasshopperDocumentTarget
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("runtimeId")]
        public string RuntimeId { get; set; }
    }

    internal class RhinoDocumentTarget
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("runtimeSerialNumber")]
        public uint RuntimeSerialNumber { get; set; }
    }

    /// <summary>
    /// Captures the documents addressed by a request. The Grasshopper document is
    /// the document connected to this backend component. Rhino operations address
    /// RhinoDoc.ActiveDoc at execution time.
    /// </summary>
    internal sealed class TargetIdentityProvider
    {
        private readonly Func<string> _backendInstanceId;

        public TargetIdentityProvider(Func<string> backendInstanceId)
        {
            _backendInstanceId = backendInstanceId ?? throw new ArgumentNullException(nameof(backendInstanceId));
        }

        public DocumentTarget CaptureCurrent(GH_Document ghDocument)
        {
            return Capture(ghDocument, RhinoDoc.ActiveDoc);
        }

        public DocumentTarget Capture(GH_Document ghDocument, RhinoDoc rhinoDocument)
        {
            return new DocumentTarget
            {
                BackendInstanceId = _backendInstanceId() ?? "",
                GhDocument = ghDocument == null
                    ? null
                    : new GrasshopperDocumentTarget
                    {
                        Path = string.IsNullOrWhiteSpace(ghDocument.FilePath)
                            ? null
                            : ghDocument.FilePath,
                        RuntimeId = ghDocument.RuntimeID.ToString(),
                    },
                RhinoDocument = rhinoDocument == null
                    ? null
                    : new RhinoDocumentTarget
                    {
                        Name = rhinoDocument.Name ?? "",
                        RuntimeSerialNumber = rhinoDocument.RuntimeSerialNumber,
                    },
            };
        }
    }
}
