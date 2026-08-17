using System;
using System.Text.Json.Serialization;
using Rhino;

namespace rhino_zmq_poc
{
    internal class RunRhinoScriptParams
    {
        public string Mode { get; set; }
        public string Source { get; set; }
        public bool Echo { get; set; }
    }

	internal class RunRhinoScriptResult
	{
		[JsonPropertyName("ok")]
		public bool Ok { get; set; }

		[JsonPropertyName("output")]
		public string Output { get; set; }

		[JsonPropertyName("error")]
		public string Error { get; set; }
    }

    internal static class RhinoScriptExecutor
    {
        public static RhinoDoc ResolveRhinoDoc()
        {
            return RhinoDoc.ActiveDoc;
        }

        public static RunRhinoScriptResult Run(RunRhinoScriptParams p)
        {
            if (p == null || string.IsNullOrWhiteSpace(p.Mode))
                return Fail("Invalid params: mode is required");
            if (string.IsNullOrWhiteSpace(p.Source))
                return Fail("Invalid params: source is required");

            var rhinoDoc = ResolveRhinoDoc();
            if (rhinoDoc == null)
                return Fail("No active Rhino document");

            var mode = p.Mode.Trim().ToLowerInvariant();
            try
            {
                return mode switch
                {
                    "command" => RunCommand(rhinoDoc, p.Source, p.Echo),
                    "python" => RunScript(rhinoDoc, "python", p.Source),
                    "csharp" => RunScript(rhinoDoc, "csharp", p.Source),
                    _ => Fail($"Unknown mode '{p.Mode}' (use command, python, or csharp)")
                };
            }
            catch (Exception ex)
            {
                return Fail($"{ex.GetType().Name}: {ex.Message}");
            }
        }

        private static RunRhinoScriptResult RunCommand(RhinoDoc doc, string source, bool echo)
        {
            var ok = RhinoApp.RunScript(
                doc.RuntimeSerialNumber,
                source,
                "Hopper agent",
                echo);

            if (!ok)
                return Fail("RhinoApp.RunScript returned false");

            doc.Views.Redraw();
            return Success("");
        }

        private static RunRhinoScriptResult RunScript(RhinoDoc doc, string mode, string source)
        {
            var result = RhinoCodeRunner.Run(doc, mode, source);
            if (!result.Ok)
                return Fail(result.Error ?? $"{mode} script execution failed", result.Output);

            doc.Views.Redraw();
            return Success(result.Output);
        }

        private static RunRhinoScriptResult Success(string output) =>
            new RunRhinoScriptResult { Ok = true, Output = output?.TrimEnd() ?? "" };

        private static RunRhinoScriptResult Fail(string error, string partialOutput = null) =>
            new RunRhinoScriptResult
            {
                Ok = false,
                Error = error,
                Output = partialOutput?.TrimEnd() ?? ""
            };
    }
}
