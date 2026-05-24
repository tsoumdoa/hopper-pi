using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Grasshopper;
using Grasshopper.Kernel;

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
                        catch { }

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
            string docName = doc?.FilePath ?? "Untitled";
            string xml = XmlPublisher.SerializeToXml(doc) ?? "";

            var canvasResponse = new GetCurrentCanvasResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                DocName = docName,
                Xml = xml
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

                var inputs = comp.Params.Input.Select(p => new ScriptParamInfo
                {
                    Name = p.Name,
                    Access = Utilities.AccessStr(p.Access),
                    DataMapping = Utilities.MappingStr(p.DataMapping),
                    Simplify = p.Simplify,
                    Reverse = p.Reverse
                }).ToList();

                var outputs = comp.Params.Output.Select(p => new ScriptParamInfo
                {
                    Name = p.Name,
                    Access = Utilities.AccessStr(p.Access),
                    DataMapping = Utilities.MappingStr(p.DataMapping),
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
