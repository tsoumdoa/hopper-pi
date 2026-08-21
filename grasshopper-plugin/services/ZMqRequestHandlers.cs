using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal interface IUiRequestHandler
    {
        string Handle(GH_Document doc, JsonElement root);
    }

    internal class UiRequestDispatcher
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

    internal class ListAllComponentsHandler : IUiRequestHandler
    {
        private readonly TargetIdentityProvider _targetIdentity;

        public ListAllComponentsHandler(TargetIdentityProvider targetIdentity)
        {
            _targetIdentity = targetIdentity;
        }

        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() => HandleOnUiThread(doc), TimeSpan.FromSeconds(5));
        }

        private string HandleOnUiThread(GH_Document doc)
        {
            var target = _targetIdentity.CaptureCurrent(doc);
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
                    Name = d.Name ?? "",
                    Guid = proxy.Guid.ToString(),
                    PluginName = pluginName,
                    AssemblyName = assemblyName,
                    Category = d.Category ?? "",
                    SubCategory = d.SubCategory ?? "",
                    Description = d.Description ?? ""
                });
            }

            var response = new ListAllComponentsResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Target = target,
                Components = components
            };

            return JsonSerializer.Serialize(response);
        }
    }

    internal class GetCurrentCanvasHandler : IUiRequestHandler
    {
        private readonly TargetIdentityProvider _targetIdentity;

        public GetCurrentCanvasHandler(TargetIdentityProvider targetIdentity)
        {
            _targetIdentity = targetIdentity;
        }

        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() => HandleOnUiThread(doc, root), TimeSpan.FromSeconds(5));
        }

        private string HandleOnUiThread(GH_Document doc, JsonElement root)
        {
            var target = _targetIdentity.CaptureCurrent(doc);
            string docName = doc?.FilePath ?? "Untitled";
            string xml = XmlPublisher.SerializeToXml(doc) ?? "";

            var selectionOnly = root.TryGetProperty("selectionOnly", out var selProp)
                && selProp.ValueKind == JsonValueKind.True;

            var canvasResponse = new GetCurrentCanvasResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Target = target,
                DocName = docName,
                Xml = xml
            };

            if (selectionOnly)
                canvasResponse.SelectedInstanceGuids = CanvasSelection.GetSelectedInstanceGuids(doc);

            return JsonSerializer.Serialize(canvasResponse);
        }
    }

    internal class GetCanvasErrorsHandler : IUiRequestHandler
    {
		private readonly TargetIdentityProvider _targetIdentity;

		public GetCanvasErrorsHandler(TargetIdentityProvider targetIdentity)
		{
			_targetIdentity = targetIdentity;
		}

        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() => HandleOnUiThread(doc), TimeSpan.FromSeconds(5));
        }

		private string HandleOnUiThread(GH_Document doc)
        {
            var messages = GhMessageReader.GetAllWarningsAndErrors(doc);

            var response = new GetCanvasErrorsResponse
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
				Target = _targetIdentity.CaptureCurrent(doc),
                DocName = doc?.FilePath ?? "Untitled",
                Errors = messages
            };

            return JsonSerializer.Serialize(response);
        }
    }

    internal class ApplyGraphHandler : IUiRequestHandler
    {
        private readonly TargetIdentityProvider _targetIdentity;

        public ApplyGraphHandler(TargetIdentityProvider targetIdentity)
        {
            _targetIdentity = targetIdentity;
        }

        public string Handle(GH_Document doc, JsonElement root)
        {
            DocumentTarget executionTarget = null;
            try
            {
                return Utilities.RunOnUiThread(() =>
                {
                    executionTarget = _targetIdentity.CaptureCurrent(doc);
                    try
                    {
                        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(root.GetRawText());
                        if (request == null)
                            return JsonSerializer.Serialize(new
                            {
                                error = "Invalid applyGraph request",
                                target = executionTarget,
                            });

                        var response = GraphOperations.Apply(doc, request);
                        response.Target = executionTarget;
                        return JsonSerializer.Serialize(response);
                    }
                    catch (Exception ex)
                    {
                        return JsonSerializer.Serialize(new
                        {
                            error = $"{ex.GetType().Name} - {ex.Message}",
                            target = executionTarget,
                        });
                    }
                }, TimeSpan.FromSeconds(30));
            }
            catch (TimeoutException)
            {
                // The apply did not finish within the 30s UI-thread window. The work
                // may still complete on the UI thread after we return, so the canvas
                // outcome is genuinely UNKNOWN — it is neither a clean failure nor a
                // safe rollback. Surface this distinctly (ok=false, timedOut=true) so
                // callers do not mistake it for a retriable failure that would
                // duplicate the graph. (A plain { error } would map to BACKEND_ERROR
                // and invite a blind retry.)
                return JsonSerializer.Serialize(new ApplyGraphResponse
                {
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Target = executionTarget,
                    Ok = false,
                    RolledBack = false,
                    TimedOut = true,
                    Counts = new ApplyGraphCounts(),
                    Refs = new Dictionary<string, string>(),
                    StructuralErrors = new List<ApplyGraphStructuralError>
                    {
                        new ApplyGraphStructuralError
                        {
                            Path = "$",
                            Code = "UI_TIMEOUT",
                            Message = "Apply did not complete within the 30s UI-thread window; the canvas outcome is unknown. Inspect the canvas before retrying to avoid duplicating the graph.",
                        },
                    },
                    ElapsedMs = 0,
                });
            }
        }
    }

    internal class ListScriptParamsHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() => HandleOnUiThread(doc, root), TimeSpan.FromSeconds(5));
        }

        private static string HandleOnUiThread(GH_Document doc, JsonElement root)
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
                    Reverse = p.Reverse,
                    TypeHint = GhScriptReflector.GetTypeHintName(p)
                }).ToList();

                var outputs = comp.Params.Output.Select(p => new ScriptParamInfo
                {
                    Name = p.Name,
                    Access = Utilities.AccessStr(p.Access),
                    DataMapping = Utilities.MappingStr(p.DataMapping),
                    Simplify = p.Simplify,
                    Reverse = p.Reverse,
                    TypeHint = GhScriptReflector.GetTypeHintName(p)
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

    internal class GetScriptCodeHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() => HandleOnUiThread(doc, root), TimeSpan.FromSeconds(5));
        }

        private static string HandleOnUiThread(GH_Document doc, JsonElement root)
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

    internal class RunRhinoScriptHandler : IUiRequestHandler
    {
        private readonly TargetIdentityProvider _targetIdentity;

        public RunRhinoScriptHandler(TargetIdentityProvider targetIdentity)
        {
            _targetIdentity = targetIdentity;
        }

        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() =>
            {
                DocumentTarget executionTarget = null;
                try
                {
                    var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
                    executionTarget = _targetIdentity.Capture(doc, rhinoDoc);
                    var mode = root.TryGetProperty("mode", out var modeEl)
                        ? modeEl.GetString()
                        : null;
                    var source = root.TryGetProperty("source", out var sourceEl)
                        ? sourceEl.GetString()
                        : null;
                    var echo = root.TryGetProperty("echo", out var echoEl) && echoEl.GetBoolean();

                    var result = RhinoScriptExecutor.Run(rhinoDoc, new RunRhinoScriptParams
                    {
                        Mode = mode,
                        Source = source,
                        Echo = echo
                    });

                    var response = new RunRhinoScriptResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Target = executionTarget,
                        Ok = result.Ok,
                        Output = result.Output ?? "",
                        Error = result.Error ?? ""
                    };

                    return JsonSerializer.Serialize(response);
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new RunRhinoScriptResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Target = executionTarget,
                        Ok = false,
                        Error = $"{ex.GetType().Name} - {ex.Message}"
                    });
                }
            });
        }
    }

    internal class GetParamRhinoGeometryHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() =>
            {
                try
                {
                    var targetId = root.TryGetProperty("targetId", out var idEl)
                        ? idEl.GetString()
                        : null;
                    if (string.IsNullOrEmpty(targetId))
                        return JsonSerializer.Serialize(new { error = "targetId is required" });

                    var result = RhinoParamGeometryOps.GetParamRhinoGeometry(doc, new GetParamRhinoGeometryParams
                    {
                        TargetId = targetId,
                    });

                    return JsonSerializer.Serialize(new
                    {
                        type = "getParamRhinoGeometry.response",
                        timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        targetId = result.TargetId,
                        paramName = result.ParamName,
                        volatileItems = result.Volatile,
                        persistentItems = result.Persistent,
                    });
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { error = $"{ex.GetType().Name} - {ex.Message}" });
                }
            });
        }
    }

    internal class QueryRhinoObjectsHandler : IUiRequestHandler
    {
        private readonly TargetIdentityProvider _targetIdentity;

        public QueryRhinoObjectsHandler(TargetIdentityProvider targetIdentity)
        {
            _targetIdentity = targetIdentity;
        }

        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() =>
            {
                DocumentTarget executionTarget = null;
                try
                {
                    var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
                    executionTarget = _targetIdentity.Capture(doc, rhinoDoc);
                    var query = new QueryRhinoObjectsParams();
                    if (root.TryGetProperty("selectionOnly", out var selEl))
                        query.SelectionOnly = selEl.GetBoolean();
                    if (root.TryGetProperty("layer", out var layerEl))
                        query.Layer = layerEl.GetString();
                    if (root.TryGetProperty("objectType", out var typeEl))
                        query.ObjectType = typeEl.GetString();
                    if (root.TryGetProperty("objectIds", out var idsEl) && idsEl.ValueKind == JsonValueKind.Array)
                    {
                        query.ObjectIds = new List<string>();
                        foreach (var item in idsEl.EnumerateArray())
                        {
                            var id = item.GetString();
                            if (!string.IsNullOrEmpty(id))
                                query.ObjectIds.Add(id);
                        }
                    }

                    var objects = RhinoObjectQuery.Query(rhinoDoc, query);

                    var response = new QueryRhinoObjectsResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Target = executionTarget,
                        Objects = objects.Select(o => new RhinoObjectInfoDto
                        {
                            ObjectId = o.ObjectId,
                            Name = o.Name,
                            Layer = o.Layer,
                            ObjectType = o.ObjectType,
                        }).ToList(),
                    };

                    return JsonSerializer.Serialize(response);
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new
                    {
                        error = $"{ex.GetType().Name} - {ex.Message}",
                        target = executionTarget,
                    });
                }
            });
        }
    }

    internal class CaptureRhinoViewHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() =>
            {
                try
                {
                    var param = root.Deserialize<CaptureRhinoViewParams>();
                    var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
                    return JsonSerializer.Serialize(ViewportCaptureOps.Capture(rhinoDoc, param));
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { error = $"{ex.GetType().Name} - {ex.Message}" });
                }
            }, TimeSpan.FromSeconds(10));
        }
    }

    internal class ControlRhinoViewHandler : IUiRequestHandler
    {
        public string Handle(GH_Document doc, JsonElement root)
        {
            return Utilities.RunOnUiThread(() =>
            {
                try
                {
                    var param = root.Deserialize<ControlRhinoViewParams>();
                    var rhinoDoc = RhinoScriptExecutor.ResolveRhinoDoc();
                    return JsonSerializer.Serialize(ViewportCaptureOps.Control(rhinoDoc, param));
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { error = $"{ex.GetType().Name} - {ex.Message}" });
                }
            }, TimeSpan.FromSeconds(10));
        }
    }
}
