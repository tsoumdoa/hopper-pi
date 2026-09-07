using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Rhino;
using Rhino.Commands;

namespace rhino_zmq_poc
{
    internal sealed class RhinoCodeRunResult
    {
        public bool Ok { get; set; }
        public string Output { get; set; } = "";
        public string Error { get; set; }
    }

    /// <summary>
    /// Runs Rhino 8+ scripts through Rhino.Runtime.Code (RhinoCode) via reflection,
    /// since RhinoCode ships in-process with Rhino and is not in the RhinoCommon NuGet.
    /// </summary>
    internal static partial class RhinoCodeRunner
    {
        private const string PythonShebang = "#! python 3";
        private const string CSharpShebang = "// #! csharp";

        private static readonly string[] RhinoCodeAssemblyHints =
        {
            "Rhino.Runtime.Code",
            "RhinoCode",
            "RhinoCodePlatform.Rhino3D",
        };

        private static readonly HashSet<string> CompletedModes =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private static readonly object LanguageWarmupLock = new object();
        private static readonly HashSet<string> WarmedModes =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private static readonly string[] RhinoPlatformAssemblyHints =
        {
            "RhinoCodePlatform.Rhino3D",
        };

        private static bool IsAvailable()
        {
            return TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out _) &&
                   TryResolveRhinoCodeType("Rhino.Runtime.Code.Execution.RunContext", out _) &&
                   TryResolveRhinoCodeType("Rhino.Runtime.Code.Languages.LanguageSpec", out _) &&
                   TryResolveRhinoCodeType("RhinoCodePlatform.Rhino3D.Registrar", out _);
        }

        internal static void EnsureRuntimeAvailable(Func<bool> isAvailable = null, Func<bool> loadPlugin = null)
        {
            isAvailable ??= IsAvailable;
            if (isAvailable()) return;

            // RhinoCodePlugin's OnLoad starts the scripting platform without opening
            // the editor or requiring a document. Let Rhino resolve its dependencies.
            loadPlugin ??= () => Rhino.PlugIns.PlugIn.LoadPlugIn(
                new Guid("c9cba87a-23ce-4f15-a918-97645c05cde7"), true, false);
            if (!loadPlugin())
                throw new InvalidOperationException("RhinoCode scripting plugin could not be loaded.");
            if (!isAvailable())
                throw new InvalidOperationException("RhinoCode scripting runtime is unavailable after loading its plugin.");
        }

        public static RhinoCodeRunResult Run(RhinoDoc doc, string mode, string source)
        {
            if (doc == null)
                return Fail("No active Rhino document");

            if (string.IsNullOrWhiteSpace(source))
                return Fail("Invalid params: source is required");

            var diagnostics = new RhinoScriptDiagnostics(mode, CompletedModes.Contains(mode));
            using var outputStream = new MemoryStream();
            object runContext = null;
            var captureWasEnabled = RhinoApp.CommandWindowCaptureEnabled;
            try
            {
                RhinoApp.CommandWindowCaptureEnabled = true;
                diagnostics.Enter("runtime-bootstrap");
                EnsureRuntimeAvailable();
                diagnostics.Enter("document-context");
                runContext = CreateRunContext(doc, outputStream);
                var runError = InvokeRunScript(PrepareSource(mode, source), runContext, mode, diagnostics);
                if (!string.IsNullOrWhiteSpace(runError))
                    return Fail(diagnostics.Failure(runError), CaptureOutput(outputStream, runContext));

                diagnostics.Enter("output-capture");
                var output = CaptureOutput(outputStream, runContext);
                CompletedModes.Add(mode);
                return Success(output);
            }
            catch (Exception ex)
            {
                return Fail(diagnostics.Failure(FormatException(ex)), CaptureOutput(outputStream, runContext));
            }
            finally
            {
                RhinoApp.CommandWindowCaptureEnabled = captureWasEnabled;
            }
        }

        // Diagnostic reads must not replace the original script error if a getter fails.
        private static string CaptureOutput(MemoryStream stream, object context) =>
            RhinoScriptDiagnostics.CollectOutput(
                () => ReadStream(stream),
                () => TryReadContextOutput(context),
                () => string.Join("\n", FilterCapturedCommandLines(
                    RhinoApp.CapturedCommandWindowStrings(true))));

        private static string[] FilterCapturedCommandLines(IEnumerable<string> lines)
        {
            if (lines == null)
                return Array.Empty<string>();

            var filtered = new List<string>();
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                if (line.StartsWith("Command:", StringComparison.OrdinalIgnoreCase))
                    continue;
                filtered.Add(line);
            }

            return filtered.ToArray();
        }

        private static string PrepareSource(string mode, string source)
        {
            var trimmed = source.TrimStart();
            var normalizedMode = (mode ?? "").Trim().ToLowerInvariant();

            if (normalizedMode == "python")
            {
                if (trimmed.StartsWith("#!", StringComparison.Ordinal))
                    return source;
                return PythonShebang + "\n" + source;
            }

            if (normalizedMode == "csharp")
            {
                if (trimmed.StartsWith("// #!", StringComparison.Ordinal) ||
                    trimmed.StartsWith("#!", StringComparison.Ordinal))
                    return source;
                return CSharpShebang + "\n" + source;
            }

            return source;
        }

        private static object CreateRunContext(RhinoDoc doc, MemoryStream outputStream)
        {
            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.Execution.RunContext", out var runContextType))
                throw new InvalidOperationException("RunContext type not found");

            // Rhino 8 RunContext has no parameterless ctor; use (defaultOutputStream, defaultErrorStream).
            // Pass false so we can assign our own MemoryStream to OutputStream.
            var ctx = Activator.CreateInstance(runContextType, false, false);
            if (ctx == null)
                throw new InvalidOperationException("Failed to create RunContext");

            TrySetMember(ctx, "OutputStream", outputStream);
            TrySetMember(ctx, "ErrorStream", outputStream);
            TrySetMember(ctx, "AutoApplyParams", true);
            // Outer RhinoAgentTransaction already groups one agent turn into one undo step.
            TrySetMember(ctx, "RecordDocumentUndo", !RhinoAgentTransaction.IsActive);

            PrepareRunContextForRhinoDoc(ctx, doc);

            return ctx;
        }

        private static void PrepareRunContextForRhinoDoc(object ctx, RhinoDoc doc)
        {
            if (ctx == null || doc == null)
                return;

            if (TryResolveRhinoPlatformType(
                    "RhinoCodePlatform.Rhino3D.Projects.Rhino3DProjectServer",
                    out var serverType))
            {
                var mockCommand = serverType.GetMethod(
                        "get_MockCommand",
                        BindingFlags.NonPublic | BindingFlags.Static)?
                    .Invoke(null, null);

                if (mockCommand != null)
                {
                    var prepareContext = serverType.GetMethod(
                        "PrepareContext",
                        BindingFlags.NonPublic | BindingFlags.Static,
                        null,
                        new[] { ctx.GetType(), mockCommand.GetType(), typeof(RhinoDoc), typeof(RunMode) },
                        null);
                    prepareContext?.Invoke(null, new object[] { ctx, mockCommand, doc, default(RunMode) });
                }
            }

            // Fallback if platform PrepareContext is unavailable.
            if (!ContextHasInput(ctx, "__rhino_doc__"))
                SetContextInput(ctx, "__rhino_doc__", doc);

            SetContextInput(ctx, "__rhino_runmode__", default(RunMode));
            SetContextInput(ctx, "__is_interactive__", false);

            var options = TryGetMember(ctx, "Options");
            if (options != null)
                TrySetContextOption(options, "grasshopper.runner.asCommand", true);
        }

        private static string InvokeRunScript(string script, object runContext, string mode, RhinoScriptDiagnostics diagnostics)
        {
            if (TryRunViaLanguageCreateCode(script, runContext, mode, diagnostics, out var languageError))
                return languageError;

            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out var rhinoCodeType))
                throw new InvalidOperationException("RhinoCode type not found");

            var runScript = rhinoCodeType.GetMethod(
                "RunScript",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { typeof(string), runContext.GetType() },
                null);
            if (runScript == null)
                throw new InvalidOperationException("RhinoCode.RunScript(string, RunContext) was not found");

            diagnostics.Enter("fallback-run-script (compile/execute)");
            var result = runScript.Invoke(null, new[] { script, runContext });
            return InterpretRunResult(result);
        }

        private static bool TryRunViaLanguageCreateCode(
            string script,
            object runContext,
            string mode,
            RhinoScriptDiagnostics diagnostics,
            out string error)
        {
            error = null;
            diagnostics.Enter("language-lookup");

            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out var rhinoCodeType))
                return false;

            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.Languages.LanguageSpec", out var languageSpecType))
                return false;

            var languageSpec = ResolveLanguageSpec(languageSpecType, mode, script);
            if (languageSpec == null)
                return false;

            var languagesProperty = rhinoCodeType.GetProperty("Languages", BindingFlags.Public | BindingFlags.Static);
            var languages = languagesProperty?.GetValue(null);
            if (languages == null)
                return false;

            var queryLatest = languages.GetType().GetMethod(
                "QueryLatest",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { languageSpecType },
                null);
            if (queryLatest == null)
                return false;

            var language = queryLatest.Invoke(languages, new[] { languageSpec });
            diagnostics.LanguageAvailableBeforeWarmup = language != null;
            if (!IsLanguageReady(language))
            {
                diagnostics.Enter("language-warmup");
                if (!EnsureLanguageReady(mode, languages, languageSpecType, languageSpec, queryLatest))
                {
                    error =
                        $"RhinoCode language for mode '{mode}' failed to initialize. " +
                        "First-time Python setup can take up to a minute — watch the Rhino status bar.";
                    return true;
                }

                language = queryLatest.Invoke(languages, new[] { languageSpec });
                if (language == null)
                {
                    error =
                        $"RhinoCode language for mode '{mode}' is not available after warmup.";
                    return true;
                }
            }

            var createCode = language.GetType().GetMethod("CreateCode", new[] { typeof(string) });
            if (createCode == null)
                return false;

            diagnostics.Enter("create-code");
            var code = createCode.Invoke(language, new object[] { script });
            if (code == null)
            {
                error = "RhinoCode failed to compile script";
                return true;
            }

            var runContextType = runContext.GetType();
            var runMethod = code.GetType().GetMethod("Run", new[] { runContextType }) ??
                            code.GetType().GetMethod("Run");
            if (runMethod == null)
                return false;

            diagnostics.Enter("code-run (may include lazy initialization/compilation)");
            var result = runMethod.Invoke(code, new[] { runContext });
            error = InterpretRunResult(result);
            return true;
        }

        private static object ResolveLanguageSpec(Type languageSpecType, string mode, string script)
        {
            var normalizedMode = (mode ?? "").Trim().ToLowerInvariant();
            string propertyName = normalizedMode switch
            {
                "python" => "Python3",
                "csharp" => "CSharp",
                _ => null,
            };

            if (!string.IsNullOrEmpty(propertyName))
            {
                var property = languageSpecType.GetProperty(
                    propertyName,
                    BindingFlags.Public | BindingFlags.Static);
                var fromMode = property?.GetValue(null);
                if (fromMode != null)
                    return fromMode;
            }

            var languageId = normalizedMode switch
            {
                "python" => "mcneel.pythonnet.python",
                "csharp" => "mcneel.roslyn.csharp",
                _ => DetectLanguageId(script),
            };
            return Activator.CreateInstance(languageSpecType, languageId);
        }

        private static string DetectLanguageId(string script)
        {
            var trimmed = script.TrimStart();
            if (trimmed.StartsWith("// #! csharp", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith("#! csharp", StringComparison.OrdinalIgnoreCase))
                return "mcneel.roslyn.csharp";

            if (trimmed.StartsWith("#! python 2", StringComparison.OrdinalIgnoreCase))
                return "mcneel.ironpython.python2";

            return "mcneel.pythonnet.python";
        }

        internal static bool EnsureLanguageReady(
            string mode,
            object languages,
            Type languageSpecType,
            object languageSpec,
            MethodInfo queryLatest,
            Action startLanguage = null)
        {
            lock (LanguageWarmupLock)
            {
                if (WarmedModes.Contains(mode) &&
                    IsLanguageReady(queryLatest.Invoke(languages, new[] { languageSpec })))
                    return true;

                WarmedModes.Remove(mode);
                if (startLanguage != null)
                    startLanguage();
                else if (!TryWarmupViaRegistrar(languageSpecType, languageSpec))
                    WarmupViaScriptEditorMacro(mode);

                WaitForLanguage(languages, languageSpecType, languageSpec);
                var language = queryLatest.Invoke(languages, new[] { languageSpec });
                if (language == null) return false;
                if (!IsLanguageReady(language))
                    throw new InvalidOperationException($"RhinoCode {mode} initialization did not become ready. " +
                        ReadLanguageFailure(language));

                WarmedModes.Add(mode);
                return true;
            }
        }

        private static bool IsLanguageReady(object language)
        {
            var status = GetLanguageStatus(language);
            return TryGetMember(status, "IsReady") is true &&
                   !(TryGetMember(status, "IsErrored") is true);
        }

        private static object GetLanguageStatus(object language)
        {
            // Rhino implements ILanguage.Status explicitly; it is not a public
            // property on the concrete language class.
            if (language == null) return null;
            foreach (var contract in language.GetType().GetInterfaces())
            {
                var property = contract.GetProperty("Status");
                if (property != null) return property.GetValue(language);
            }
            return TryGetMember(language, "Status");
        }

        private static string ReadLanguageFailure(object language)
        {
            var status = GetLanguageStatus(language);
            var progress = TryGetMember(status, "Progress");
            var details = new List<string>();
            if (TryGetMember(progress, "Message") is string message)
                details.Add(message);
            if (TryGetMember(progress, "Diagnostics") is System.Collections.IEnumerable diagnostics)
                foreach (var diagnostic in diagnostics)
                    details.Add(diagnostic?.ToString() ?? "");
            return details.Count > 0 ? string.Join("\n", details) : "Language status does not report IsReady=true.";
        }

        private static bool TryWarmupViaRegistrar(Type languageSpecType, object languageSpec)
        {
            if (!TryResolveRhinoCodeType("RhinoCodePlatform.Rhino3D.Registrar", out var registrarType))
                return false;

            if (TryResolveRhinoCodeType(
                    "Rhino.Runtime.Code.Languages.IProgressWaitStateResponder",
                    out var responderInterface) &&
                TryResolveRhinoCodeType(
                    "RhinoCodePlatform.Rhino3D.Languages.RhinoWriteStatusResponder",
                    out var responderType) &&
                responderInterface.IsAssignableFrom(responderType))
            {
                var responder = Activator.CreateInstance(responderType);
                var startWithResponder = registrarType.GetMethod(
                    "StartScriptingLanguages",
                    BindingFlags.Public | BindingFlags.Static,
                    null,
                    new[] { responderInterface, languageSpecType, typeof(bool) },
                    null);
                if (startWithResponder != null)
                {
                    startWithResponder.Invoke(null, new[] { responder, languageSpec, true });
                    return true;
                }
            }

            var startScripting = registrarType.GetMethod(
                "StartScripting",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { typeof(bool) },
                null);
            startScripting?.Invoke(null, new object[] { true });

            var startLanguage = registrarType.GetMethod(
                "StartScriptingLanguages",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { languageSpecType, typeof(bool) },
                null);
            if (startLanguage != null)
            {
                startLanguage.Invoke(null, new[] { languageSpec, true });
                return true;
            }

            return startScripting != null;
        }

        internal static void WaitForLanguage(
            object languages,
            Type languageSpecType,
            object languageSpec)
        {
            var waitStatusComplete = languages.GetType().GetMethod(
                "WaitStatusComplete",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { languageSpecType },
                null);
            if (waitStatusComplete == null)
                throw new InvalidOperationException(
                    "RhinoCode language registry does not support WaitStatusComplete(LanguageSpec); " +
                    "language readiness could not be established.");

            // Rhino's one-argument overload creates its own progress responder,
            // invokes pending loaders, and waits for completion, including errors.
            // EnsureLanguageReady must check IsReady after this call.
            // Do not follow it with WaitLoadComplete(spec, null): that method
            // unconditionally calls the reporter, even with no pending loaders.
            waitStatusComplete.Invoke(languages, new[] { languageSpec });
        }

        private static void WarmupViaScriptEditorMacro(string mode)
        {
            // Documented Rhino 8 command; no-op if unavailable on this build.
            RhinoApp.RunScript("StartScriptServer", false);

            var normalizedMode = (mode ?? "").Trim().ToLowerInvariant();
            string path;
            string contents;

            if (normalizedMode == "csharp")
            {
                path = Path.Combine(Path.GetTempPath(), "hopper-rhinocode-warmup.cs");
                contents = CSharpShebang + "\n;";
            }
            else
            {
                path = Path.Combine(Path.GetTempPath(), "hopper-rhinocode-warmup.py");
                contents = PythonShebang + "\npass";
            }

            File.WriteAllText(path, contents);
            var escaped = path.Replace("\"", "\\\"");
            RhinoApp.RunScript($"_-ScriptEditor _R \"{escaped}\"", false);
        }

        private static string InterpretRunResult(object result)
        {
            if (result == null)
                return null;

            if (result is bool ok && !ok)
                return "RhinoCode.RunScript returned false";

            var resultType = result.GetType();
            var successProperty = resultType.GetProperty("Success") ?? resultType.GetProperty("Ok");
            if (successProperty?.PropertyType == typeof(bool))
            {
                var success = (bool)successProperty.GetValue(result);
                if (!success)
                {
                    var messageProperty = resultType.GetProperty("Message") ??
                                          resultType.GetProperty("Error") ??
                                          resultType.GetProperty("ErrorMessage");
                    var message = messageProperty?.GetValue(result) as string;
                    return string.IsNullOrWhiteSpace(message)
                        ? "RhinoCode script execution failed"
                        : message;
                }
            }

            return null;
        }

        private static string TryReadContextOutput(object runContext)
        {
            foreach (var propertyName in new[] { "StandardOutput", "Stdout", "Output", "ConsoleOutput" })
            {
                var value = TryGetMember(runContext, propertyName);
                if (value == null)
                    continue;

                if (value is string text && !string.IsNullOrWhiteSpace(text))
                    return text.TrimEnd();

                if (value is MemoryStream ms)
                    return ReadStream(ms);
            }

            return "";
        }

        private static string ReadStream(MemoryStream stream)
        {
            if (stream == null || stream.Length == 0)
                return "";

            var position = stream.Position;
            stream.Position = 0;
            var text = Encoding.UTF8.GetString(stream.ToArray()).TrimEnd();
            stream.Position = position;
            return text;
        }
    }
}
