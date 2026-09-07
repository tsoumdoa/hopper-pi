using System;
using System.Reflection;
using Rhino;

namespace rhino_zmq_poc
{
    internal static partial class RhinoCodeRunner
    {
        private static readonly RhinoScriptPreloader Preloader = new RhinoScriptPreloader();

        internal static void PreloadLanguages() =>
            Preloader.Initialize(InitializeLanguage, message => RhinoApp.WriteLine(message));

        // Initialization needs no active document and runs no user script.
        internal static void InitializeLanguage(string mode)
        {
            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out var codeType) ||
                !TryResolveRhinoCodeType("Rhino.Runtime.Code.Languages.LanguageSpec", out var specType))
                throw new InvalidOperationException("RhinoCode scripting runtime is unavailable.");

            var spec = ResolveLanguageSpec(specType, mode, "");
            var languages = codeType.GetProperty("Languages", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            var queryLatest = languages?.GetType().GetMethod("QueryLatest", BindingFlags.Public | BindingFlags.Instance,
                null, new[] { specType }, null);
            if (spec == null || languages == null || queryLatest == null)
                throw new InvalidOperationException("RhinoCode language registry is unavailable.");

            if (!EnsureLanguageReady(mode, languages, specType, spec, queryLatest))
                throw new InvalidOperationException($"RhinoCode {mode} initialization did not complete.");
        }
    }
}
