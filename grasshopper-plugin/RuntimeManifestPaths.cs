using System;
using System.IO;

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
    }
}
