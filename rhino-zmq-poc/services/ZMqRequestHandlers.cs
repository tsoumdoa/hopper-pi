using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc
{
    public interface IUiRequestHandler
    {
        string Handle(GH_Document doc, JsonElement root);
    }

    public class UiRequestDispatcher
    {
        private readonly Dictionary<string, IUiRequestHandler> _handlers = new Dictionary<string, IUiRequestHandler>();

        public void Register(string requestType, IUiRequestHandler handler)
        {
            _handlers[requestType] = handler;
        }

        public bool TryDispatch(string requestType, GH_Document doc, JsonElement root, out string response)
        {
            response = null;
            if (!_handlers.TryGetValue(requestType, out var handler)) return false;
            response = handler.Handle(doc, root);
            return true;
        }
    }

    public class ListAllComponentsHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            var components = new List<GhComponentInfo>();

            foreach (var proxy in Instances.ComponentServer.ObjectProxies)
            {
                if (proxy.Obsolete) continue;
                var d = proxy.Desc;
                if (d == null) continue;

                string pluginName = "Unknown";
                string assemblyName = "Unknown";

                try
                {
                    if (!string.IsNullOrEmpty(proxy.Location))
                    {
                        assemblyName =
                            System.IO.Path.GetFileNameWithoutExtension(proxy.Location);
                    }

                    foreach (var lib in Instances.ComponentServer.Libraries)
                    {
                        if (lib == null || lib.Assembly == null) continue;

                        string libLocation = "";
                        try { libLocation = lib.Assembly.Location; }
                        catch (Exception ex)
                        {
                            RhinoApp.WriteLine($"[ListAllComponents] Failed to get assembly location: {ex.Message}");
                        }

                        if (!string.IsNullOrEmpty(libLocation) &&
                            string.Equals(libLocation, proxy.Location,
                                StringComparison.OrdinalIgnoreCase))
                        {
                            pluginName = lib.Name;
                            break;
                        }
                    }
                }
                catch
                {
                }

                components.Add(new GhComponentInfo
                {
                    Name = d.Name,
                    Guid = proxy.Guid.ToString(),
                    PluginName = pluginName,
                    AssemblyName = assemblyName,
                    Category = d.Category,
                    SubCategory = d.SubCategory,
                    Description = d.Description
                });
            }

            var response = new ListAllComponentsResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Components = components
            };

            return JsonSerializer.Serialize(response);
        }
    }

    public class GetCurrentCanvasHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            string xml = null;
            string docName = "Untitled";

            if (doc != null)
            {
                docName = doc.FilePath ?? "Untitled";
                try
                {
                    var archive = new GH_Archive();
                    archive.AppendObject(doc, "Definition");
                    xml = archive.Serialize_Xml();
                }
                catch (Exception ex)
                {
                    RhinoApp.WriteLine($"[REP] getCurrentCanvas serialize error: {ex.Message}");
                }
            }

            var canvasResponse = new GetCurrentCanvasResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                DocName = docName,
                Xml = xml ?? ""
            };

            return JsonSerializer.Serialize(canvasResponse);
        }
    }

    public class GetCanvasErrorsHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            var messages = GhMessageReader.GetAllWarningsAndErrors(doc);

            var response = new GetCanvasErrorsResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                DocName = doc?.FilePath ?? "Untitled",
                Errors = messages
            };

            return JsonSerializer.Serialize(response);
        }
    }

    public class ListScriptParamsHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            try
            {
                var targetId = root.GetProperty("targetId").GetString();
                if (string.IsNullOrEmpty(targetId))
                    return JsonSerializer.Serialize(new { error = "targetId is required" });

                if (!Guid.TryParse(targetId, out var targetGuid))
                    return JsonSerializer.Serialize(new { error = $"invalid targetId '{targetId}'" });

                var obj = doc?.FindObject(targetGuid, false);
                if (obj == null)
                    return JsonSerializer.Serialize(new { error = $"object not found '{targetId}'" });

                var comp = obj as GH_Component;
                if (comp == null)
                    return JsonSerializer.Serialize(new { error = $"'{targetId}' is not a GH_Component" });

                string AccessStr(GH_ParamAccess a) => a switch
                {
                    GH_ParamAccess.item => "item",
                    GH_ParamAccess.list => "list",
                    GH_ParamAccess.tree => "tree",
                    _ => a.ToString()
                };

                string MappingStr(GH_DataMapping m) => m switch
                {
                    GH_DataMapping.None => "none",
                    GH_DataMapping.Flatten => "flatten",
                    GH_DataMapping.Graft => "graft",
                    _ => m.ToString()
                };

                var inputs = comp.Params.Input.Select(p => new ScriptParamInfo
                {
                    Name = p.Name,
                    Access = AccessStr(p.Access),
                    DataMapping = MappingStr(p.DataMapping),
                    Simplify = p.Simplify,
                    Reverse = p.Reverse
                }).ToList();

                var outputs = comp.Params.Output.Select(p => new ScriptParamInfo
                {
                    Name = p.Name,
                    Access = AccessStr(p.Access),
                    DataMapping = MappingStr(p.DataMapping),
                    Simplify = p.Simplify,
                    Reverse = p.Reverse
                }).ToList();

                var response = new ListScriptParamsResponse
                {
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Inputs = inputs,
                    Outputs = outputs
                };

                return JsonSerializer.Serialize(response);
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { error = $"{ex.GetType().Name} - {ex.Message}" });
            }
        }
    }

    public class GetScriptCodeHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            try
            {
                var targetId = root.GetProperty("targetId").GetString();
                if (string.IsNullOrEmpty(targetId))
                    return JsonSerializer.Serialize(new { error = "targetId is required" });

                if (!Guid.TryParse(targetId, out var targetGuid))
                    return JsonSerializer.Serialize(new { error = $"invalid targetId '{targetId}'" });

                var obj = doc?.FindObject(targetGuid, false);
                if (obj == null)
                    return JsonSerializer.Serialize(new { error = $"object not found '{targetId}'" });

                var reflector = GhScriptReflector.Get();
                var code = reflector.GetSourceCode(obj);

                var response = new GetScriptCodeResponse
                {
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Code = code ?? ""
                };

                return JsonSerializer.Serialize(response);
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { error = $"{ex.GetType().Name} - {ex.Message}" });
            }
        }
    }
}
