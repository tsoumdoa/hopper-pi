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
    internal static class RhinoCodeRunner
    {
        private const string PythonShebang = "#! python 3";
        private const string CSharpShebang = "// #! csharp";

        private static readonly string[] RhinoCodeAssemblyHints =
        {
            "Rhino.Runtime.Code",
            "RhinoCode",
            "RhinoCodePlatform.Rhino3D",
        };

        private static readonly object LanguageWarmupLock = new object();
        private static readonly HashSet<string> WarmedModes =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private static readonly string[] RhinoPlatformAssemblyHints =
        {
            "RhinoCodePlatform.Rhino3D",
        };

        public static bool IsAvailable()
        {
            return TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out _) &&
                   TryResolveRhinoCodeType("Rhino.Runtime.Code.Execution.RunContext", out _);
        }

        /// <summary>
        /// Rhino 8 defers RhinoCode language startup until Script Editor is opened.
        /// Warm up on the next UI idle so the first rh_run_script does not fail.
        /// </summary>
        public static void ScheduleWarmup(params string[] modes)
        {
            if (!IsAvailable())
                return;

            var targets = (modes == null || modes.Length == 0)
                ? new[] { "python", "csharp" }
                : modes;

            EventHandler idleHandler = null;
            idleHandler = (_, __) =>
            {
                RhinoApp.Idle -= idleHandler;
                foreach (var mode in targets)
                {
                    try
                    {
                        WarmupLanguage(mode);
                    }
                    catch
                    {
                        // Best-effort; EnsureLanguageReady retries on the next script run.
                    }
                }
            };
            RhinoApp.Idle += idleHandler;
        }

        public static RhinoCodeRunResult Run(RhinoDoc doc, string mode, string source)
        {
            if (doc == null)
                return Fail("No active Rhino document");

            if (string.IsNullOrWhiteSpace(source))
                return Fail("Invalid params: source is required");

            if (!IsAvailable())
            {
                return Fail(
                    "RhinoCode (Rhino.Runtime.Code) is not available in this Rhino session. " +
                    "Requires Rhino 8 with the Script Editor runtime loaded. " +
                    "Open Script Editor once, or use mode 'command'.");
            }

            var script = PrepareSource(mode, source);
            var outputStream = new MemoryStream();
            var capturedLines = Array.Empty<string>();

            try
            {
                RhinoApp.CommandWindowCaptureEnabled = true;
                try
                {
                    var runContext = CreateRunContext(doc, outputStream);
                    var runError = InvokeRunScript(script, runContext, mode);
                    capturedLines = RhinoApp.CapturedCommandWindowStrings(true) ?? Array.Empty<string>();
                    var output = ReadCombinedOutput(outputStream, runContext, capturedLines);

                    if (!string.IsNullOrWhiteSpace(runError))
                        return Fail(runError, output);

                    return Success(output);
                }
                finally
                {
                    RhinoApp.CommandWindowCaptureEnabled = false;
                }
            }
            catch (TargetInvocationException ex)
            {
                return Fail(FormatException(ex.InnerException ?? ex), ReadStream(outputStream));
            }
            catch (Exception ex)
            {
                return Fail(FormatException(ex), ReadStream(outputStream));
            }
        }

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
            TrySetMember(ctx, "AutoApplyParams", true);
            TrySetMember(ctx, "RecordDocumentUndo", true);

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

        private static string InvokeRunScript(string script, object runContext, string mode)
        {
            if (TryRunViaLanguageCreateCode(script, runContext, mode, out var languageError))
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

            var result = runScript.Invoke(null, new[] { script, runContext });
            return InterpretRunResult(result);
        }

        private static bool TryRunViaLanguageCreateCode(
            string script,
            object runContext,
            string mode,
            out string error)
        {
            error = null;

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
            if (language == null)
            {
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

            var languageId = DetectLanguageId(script);
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

        private static void WarmupLanguage(string mode)
        {
            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.RhinoCode", out var rhinoCodeType))
                return;
            if (!TryResolveRhinoCodeType("Rhino.Runtime.Code.Languages.LanguageSpec", out var languageSpecType))
                return;

            var languageSpec = ResolveLanguageSpec(languageSpecType, mode, PrepareSource(mode, "pass"));
            if (languageSpec == null)
                return;

            var languages = rhinoCodeType
                .GetProperty("Languages", BindingFlags.Public | BindingFlags.Static)?
                .GetValue(null);
            if (languages == null)
                return;

            var queryLatest = languages.GetType().GetMethod(
                "QueryLatest",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { languageSpecType },
                null);
            if (queryLatest == null)
                return;

            if (queryLatest.Invoke(languages, new[] { languageSpec }) != null)
            {
                lock (LanguageWarmupLock)
                {
                    WarmedModes.Add(mode);
                }
                return;
            }

            EnsureLanguageReady(mode, languages, languageSpecType, languageSpec, queryLatest);
        }

        private static bool EnsureLanguageReady(
            string mode,
            object languages,
            Type languageSpecType,
            object languageSpec,
            MethodInfo queryLatest)
        {
            lock (LanguageWarmupLock)
            {
                if (WarmedModes.Contains(mode) &&
                    queryLatest.Invoke(languages, new[] { languageSpec }) != null)
                    return true;

                if (TryWarmupViaRegistrar(languageSpecType, languageSpec))
                {
                    WaitForLanguage(languages, languageSpecType, languageSpec);
                }
                else
                {
                    WarmupViaScriptEditorMacro(mode);
                    WaitForLanguage(languages, languageSpecType, languageSpec);
                }

                if (queryLatest.Invoke(languages, new[] { languageSpec }) != null)
                {
                    WarmedModes.Add(mode);
                    return true;
                }
            }

            return queryLatest.Invoke(languages, new[] { languageSpec }) != null;
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

        private static void WaitForLanguage(
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
            waitStatusComplete?.Invoke(languages, new[] { languageSpec });

            var reporterType = languages.GetType().GetNestedType(
                "ILanguageLoadReporter",
                BindingFlags.Public | BindingFlags.NonPublic);
            if (reporterType == null)
                return;

            var waitLoadComplete = languages.GetType().GetMethod(
                "WaitLoadComplete",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { languageSpecType, reporterType },
                null);
            waitLoadComplete?.Invoke(languages, new object[] { languageSpec, null });
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

        private static string ReadCombinedOutput(
            MemoryStream outputStream,
            object runContext,
            string[] capturedLines)
        {
            var parts = new List<string>();

            var streamOutput = ReadStream(outputStream);
            if (!string.IsNullOrWhiteSpace(streamOutput))
                parts.Add(streamOutput);

            var contextOutput = TryReadContextOutput(runContext);
            if (!string.IsNullOrWhiteSpace(contextOutput))
                parts.Add(contextOutput);

            var commandOutput = string.Join("\n", FilterCapturedCommandLines(capturedLines)).TrimEnd();
            if (!string.IsNullOrWhiteSpace(commandOutput))
                parts.Add(commandOutput);

            return DeduplicateOutputParts(parts);
        }

        private static string DeduplicateOutputParts(IEnumerable<string> parts)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var lines = new List<string>();

            foreach (var part in parts)
            {
                if (string.IsNullOrWhiteSpace(part))
                    continue;

                foreach (var line in part.Replace("\r\n", "\n").Split('\n'))
                {
                    if (seen.Add(line))
                        lines.Add(line);
                }
            }

            return string.Join("\n", lines).TrimEnd();
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

        private static bool TryResolveRhinoCodeType(string fullName, out Type type) =>
            TryResolveType(fullName, RhinoCodeAssemblyHints, out type);

        private static bool TrySetMember(object target, string name, object value)
        {
            if (target == null)
                return false;

            var type = target.GetType();
            var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property != null && property.CanWrite && property.PropertyType.IsInstanceOfType(value))
            {
                property.SetValue(target, value);
                return true;
            }

            var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
            if (field != null && field.FieldType.IsInstanceOfType(value))
            {
                field.SetValue(target, value);
                return true;
            }

            return false;
        }

        private static bool TryResolveRhinoPlatformType(string fullName, out Type type) =>
            TryResolveRhinoCodeType(fullName, out type) ||
            TryResolveType(fullName, RhinoPlatformAssemblyHints, out type);

        private static bool TryResolveType(string fullName, string[] assemblyHints, out Type type)
        {
            type = Type.GetType(fullName);
            if (type != null)
                return true;

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                type = assembly.GetType(fullName, throwOnError: false, ignoreCase: false);
                if (type != null)
                    return true;
            }

            if (assemblyHints != null)
            {
                foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
                {
                    var name = assembly.GetName().Name ?? "";
                    var matchesHint = false;
                    foreach (var hint in assemblyHints)
                    {
                        if (name.Contains(hint, StringComparison.OrdinalIgnoreCase))
                        {
                            matchesHint = true;
                            break;
                        }
                    }

                    if (!matchesHint)
                        continue;

                    type = assembly.GetType(fullName, throwOnError: false, ignoreCase: false);
                    if (type != null)
                        return true;
                }
            }

            type = null;
            return false;
        }

        private static bool ContextHasInput(object runContext, string key)
        {
            var inputs = TryGetMember(runContext, "Inputs");
            if (inputs == null)
                return false;

            var containsKey = inputs.GetType().GetMethod(
                "ContainsKey",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { typeof(string) },
                null);
            if (containsKey == null)
                return false;

            return (bool)containsKey.Invoke(inputs, new object[] { key });
        }

        private static void SetContextInput(object runContext, string key, object value)
        {
            var inputs = TryGetMember(runContext, "Inputs");
            if (inputs == null)
                return;

            var setMethod = inputs.GetType().GetMethod(
                "Set",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { typeof(string), typeof(object), typeof(bool), typeof(bool) },
                null);
            if (setMethod != null)
            {
                setMethod.Invoke(inputs, new object[] { key, value, false, false });
                return;
            }

            TrySetContextInputLegacy(runContext, key, value);
        }

        private static void TrySetContextOption(object options, string key, object value)
        {
            var indexer = options.GetType().GetProperty("Item");
            if (indexer == null)
                return;

            try
            {
                indexer.SetValue(options, value, new object[] { key });
            }
            catch
            {
                // Options shape differs across Rhino versions.
            }
        }

        private static void TrySetContextInputLegacy(object runContext, string key, object value)
        {
            var inputs = TryGetMember(runContext, "Inputs");
            if (inputs == null)
                return;

            var indexer = inputs.GetType().GetProperty("Item");
            if (indexer == null)
                return;

            try
            {
                indexer.SetValue(inputs, value, new object[] { key });
            }
            catch
            {
                // Inputs collection shape differs across Rhino versions.
            }
        }

        private static object TryGetMember(object target, string name)
        {
            if (target == null)
                return null;

            var type = target.GetType();
            var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property != null)
                return property.GetValue(target);

            var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
            return field?.GetValue(target);
        }

        private static string FormatException(Exception ex) =>
            ex == null ? "Unknown error" : $"{ex.GetType().Name}: {ex.Message}";

        private static RhinoCodeRunResult Success(string output) =>
            new RhinoCodeRunResult { Ok = true, Output = output?.TrimEnd() ?? "" };

        private static RhinoCodeRunResult Fail(string error, string partialOutput = null) =>
            new RhinoCodeRunResult
            {
                Ok = false,
                Error = error,
                Output = partialOutput?.TrimEnd() ?? "",
            };
    }
}
