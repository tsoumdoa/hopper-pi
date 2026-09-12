using System;
using System.IO;
using System.Text.Json;

namespace rhino_zmq_poc
{
    internal static class RuntimeManifestPaths
    {
        public static string ResolveFile(string value, string manifestDirectory)
        {
            if (string.IsNullOrWhiteSpace(value) || Path.IsPathFullyQualified(value))
                return null;
            var path = Path.GetFullPath(Path.Combine(manifestDirectory, value));
            var relative = Path.GetRelativePath(manifestDirectory, path);
            if (relative == ".." || relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                return null;
            return File.Exists(path) ? path : null;
        }

        public static string ResolveHostEntry(string manifestPath)
        {
            if (string.IsNullOrWhiteSpace(manifestPath) || !File.Exists(manifestPath))
                return null;
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
                if (!document.RootElement.TryGetProperty("protocolVersion", out var protocolVersion)
                    || protocolVersion.ValueKind != JsonValueKind.Number
                    || protocolVersion.GetInt32() != 2
                    || !document.RootElement.TryGetProperty("hostEntry", out var hostEntry)
                    || hostEntry.ValueKind != JsonValueKind.String)
                {
                    return null;
                }

                var runtimeDirectory = Path.GetDirectoryName(Path.GetFullPath(manifestPath));
                return runtimeDirectory == null
                    ? null
                    : ResolveFile(hostEntry.GetString(), runtimeDirectory);
            }
            catch (Exception exception) when (
                exception is IOException
                    or UnauthorizedAccessException
                    or JsonException
                    or ArgumentException)
            {
                return null;
            }
        }
    }
}
