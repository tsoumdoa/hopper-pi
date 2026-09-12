using System;
using System.Reflection;
using System.Diagnostics;
using Rhino;

namespace rhino_zmq_poc
{
    internal static partial class RhinoCodeRunner
    {
        private static bool preloading;

        internal static void PreloadLanguages(Action<string> report = null)
        {
            if (preloading) return; // Runtime initialization can pump UI callbacks.
            report ??= message => RhinoApp.WriteLine(message);
            preloading = true;
            try
            {
                foreach (var mode in new[] { "python", "csharp" })
                {
                    var clock = Stopwatch.StartNew();
                    try
                    {
                        if (InitializeLanguage(mode, report))
                            report($"Hopper: {mode} ready ({clock.ElapsedMilliseconds} ms).");
                    }
                    catch (Exception ex)
                    {
                        report($"Hopper: {mode} initialization failed ({clock.ElapsedMilliseconds} ms). " +
                            $"Script execution can retry.\n{ex}");
                    }
                }
            }
            finally { preloading = false; }
        }

        // Initialization needs no active document and runs no user script.
        private static bool InitializeLanguage(string mode, Action<string> report)
        {
            EnsureRuntimeAvailable();
            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out var codeType) ||
                !TryResolveRhinoCodeType("Rhino.Runtime.Code.Languages.LanguageSpec", out var specType))
                throw new InvalidOperationException("RhinoCode scripting runtime is unavailable.");

            var spec = ResolveLanguageSpec(specType, mode, "");
            var languages = codeType.GetProperty("Languages", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            var queryLatest = languages?.GetType().GetMethod("QueryLatest", BindingFlags.Public | BindingFlags.Instance,
                null, new[] { specType }, null);
            if (spec == null || languages == null || queryLatest == null)
                throw new InvalidOperationException("RhinoCode language registry is unavailable.");

            // Reuse the execution path's cache and recheck that the language
            // is still ready instead of maintaining a second ready set.
            if (WarmedModes.Contains(mode) && IsLanguageReady(queryLatest.Invoke(languages, new[] { spec })))
                return false;

            report($"Hopper: initializing {mode}...");
            if (!EnsureLanguageReady(mode, languages, specType, spec, queryLatest))
                throw new InvalidOperationException($"RhinoCode {mode} initialization did not complete.");
            return true;
        }
    }
}
