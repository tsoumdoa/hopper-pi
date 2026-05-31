using System;
using System.Reflection;
using System.Text;
using Rhino;
using Rhino.Runtime;

namespace rhino_zmq_poc
{
    public class RunRhinoScriptParams
    {
        public string Mode { get; set; }
        public string Source { get; set; }
        public bool Echo { get; set; }
    }

    public class RunRhinoScriptResult
    {
        public bool Ok { get; set; }
        public string Output { get; set; }
        public string Error { get; set; }
    }

    public static class RhinoScriptExecutor
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
                    "python" => RunPython(rhinoDoc, p.Source),
                    "csharp" => RunCSharp(rhinoDoc, p.Source),
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

        private static RunRhinoScriptResult RunPython(RhinoDoc doc, string source)
        {
            var output = new StringBuilder();
            var py = PythonScript.Create();
            py.SetupScriptContext(doc);
            py.Output = text => output.AppendLine(text);

            if (!py.ExecuteScript(source))
                return Fail("Python script execution failed", output.ToString());

            doc.Views.Redraw();
            return Success(output.ToString());
        }

        private static RunRhinoScriptResult RunCSharp(RhinoDoc doc, string source)
        {
            if (TryRunCSharpViaRhinoCode(doc, source, out var output, out var error))
            {
                doc.Views.Redraw();
                return Success(output);
            }

            return Fail(error ?? "C# script execution failed", output);
        }

        private static bool TryRunCSharpViaRhinoCode(RhinoDoc doc, string source, out string output, out string error)
        {
            output = "";
            error = null;

            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var name = asm.GetName().Name ?? "";
                if (!name.Contains("RhinoCode", StringComparison.OrdinalIgnoreCase))
                    continue;

                if (TryInvokeRhinoCodeExecute(asm, doc, source, out output, out error))
                    return string.IsNullOrEmpty(error);
            }

            error =
                "C# execution requires Rhino 8 RhinoCode assemblies in-process. " +
                "Use mode 'python' or 'command', or run C# from the Rhino Script Editor manually.";
            return false;
        }

        private static bool TryInvokeRhinoCodeExecute(Assembly asm, RhinoDoc doc, string source, out string output, out string error)
        {
            output = "";
            error = null;
            var outputBuilder = new StringBuilder();

            Type[] types;
            try
            {
                types = asm.GetTypes();
            }
            catch
            {
                return false;
            }

            foreach (var type in types)
            {
                if (type == null || !type.IsClass || type.IsAbstract)
                    continue;

                foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance))
                {
                    if (!string.Equals(method.Name, "Execute", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(method.Name, "ExecuteScript", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(method.Name, "RunScript", StringComparison.OrdinalIgnoreCase))
                        continue;

                    var parameters = method.GetParameters();
                    if (parameters.Length < 1 || parameters.Length > 4)
                        continue;

                    try
                    {
                        object instance = null;
                        if (!method.IsStatic)
                        {
                            if (!type.IsPublic)
                                continue;
                            instance = Activator.CreateInstance(type);
                            if (instance == null)
                                continue;
                        }

                        object result = null;
                        if (parameters.Length == 1 && parameters[0].ParameterType == typeof(string))
                            result = method.Invoke(instance, new object[] { source });
                        else if (parameters.Length >= 2 &&
                                 parameters[0].ParameterType == typeof(string) &&
                                 typeof(RhinoDoc).IsAssignableFrom(parameters[1].ParameterType))
                            result = method.Invoke(instance, new object[] { source, doc });
                        else
                            continue;

                        if (result is bool ok && !ok)
                        {
                            error = $"{type.FullName}.{method.Name} returned false";
                            return false;
                        }

                        output = outputBuilder.ToString();
                        return true;
                    }
                    catch (TargetInvocationException tie)
                    {
                        error = tie.InnerException?.Message ?? tie.Message;
                        return false;
                    }
                    catch
                    {
                        // try next method
                    }
                }
            }

            return false;
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
