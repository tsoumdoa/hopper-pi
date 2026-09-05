#nullable enable

using System;
using System.IO;

namespace Hopper.Rhino.Host;

public static class GrasshopperInstallationProbe
{
    public const string AssemblyFileName = "Hopper.Grasshopper.gha";

    public static bool IsInstalled(
        string pluginDirectory,
        Func<string, bool>? fileExists = null)
    {
        if (string.IsNullOrWhiteSpace(pluginDirectory))
            throw new ArgumentException("Plugin directory is required.", nameof(pluginDirectory));

        fileExists ??= File.Exists;
        return fileExists(Path.Combine(pluginDirectory, AssemblyFileName));
    }
}
