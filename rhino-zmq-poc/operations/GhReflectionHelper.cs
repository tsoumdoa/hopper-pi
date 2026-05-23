using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public class GhScriptReflector
    {
        private static readonly Lazy<GhScriptReflector> _instance = new(() => new());

        private readonly Type _componentType;
        private static readonly Dictionary<string, Guid> ScriptGuids = new()
        {
            { "csharp",  Guid.Parse("b6ba1144-02d6-4a2d-b53c-ec62e290eeb7") },
            { "python", Guid.Parse("719467e6-7cf5-4848-99b0-c5dd57e5442c") },
        };

        private static Type _iScriptCompType;
        private static PropertyInfo _scriptTextProp;

        public MethodInfo GetRuntimeMessagesMethod { get; }

        public IEnumerable<string> SupportedLanguages => ScriptGuids.Keys;

        public static GhScriptReflector Get() => _instance.Value;

        private GhScriptReflector()
        {
            _componentType = typeof(GH_Component);
            _iScriptCompType = typeof(GH_Component).Assembly.GetTypes()
                .FirstOrDefault(t => t.Name == "IScriptComponent" && t.IsInterface)
                ?? AppDomain.CurrentDomain.GetAssemblies()
                    .SelectMany(a => { try { return a.GetTypes(); } catch { return Array.Empty<Type>(); } })
                    .FirstOrDefault(t => t.Name == "IScriptComponent" && t.IsInterface);
            if (_iScriptCompType != null)
                _scriptTextProp = _iScriptCompType.GetProperty("Text", BindingFlags.Public | BindingFlags.Instance);

            GetRuntimeMessagesMethod = FindGetRuntimeMessagesMethod();
        }

        private MethodInfo FindGetRuntimeMessagesMethod()
        {
            var candidates = new[]
            {
                "GetRuntimeMessages", "getRuntimeMessages",
                "RuntimeMessages", "runtimeMessages",
                "GetMessages", "getMessages"
            };
            foreach (var name in candidates)
            {
                var method = _componentType.GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
                if (method != null) return method;
            }
            var prop = _componentType.GetProperty("RuntimeMessages", BindingFlags.Public | BindingFlags.Instance);
            if (prop?.PropertyType.IsGenericType == true
                && prop.PropertyType.GetGenericTypeDefinition() == typeof(IEnumerable<>))
                return prop.GetGetMethod();
            return null;
        }

        public Guid ResolveLanguageGuid(string language)
        {
            var key = language.ToLowerInvariant();
            return ScriptGuids.TryGetValue(key, out var guid) ? guid : Guid.Empty;
        }

        public void SetSource(object scriptComponent, string code)
        {
            var method = scriptComponent.GetType().GetMethod("SetSource", BindingFlags.Public | BindingFlags.Instance);
            method?.Invoke(scriptComponent, new object[] { code });
        }

        public string GetSourceCode(object scriptComponent)
        {
            if (_iScriptCompType != null && _iScriptCompType.IsInstanceOfType(scriptComponent))
                return _scriptTextProp?.GetValue(scriptComponent) as string ?? "";
            return "";
        }

        public bool IsScriptComponent(IGH_DocumentObject obj)
        {
            return obj != null && _iScriptCompType != null && _iScriptCompType.IsInstanceOfType(obj);
        }

        public bool TryGetRuntimeMessages(GH_Component comp, out List<(string level, string text)> messages)
        {
            messages = new List<(string, string)>();
            try
            {
                if (GetRuntimeMessagesMethod != null)
                {
                    var result = GetRuntimeMessagesMethod.Invoke(comp, null);
                    if (result is System.Collections.IEnumerable enumerable)
                        foreach (var item in enumerable)
                        {
                            var it = item.GetType();
                            var lp = it.GetProperty("Level") ?? it.GetProperty("level") ?? it.GetProperty("MessageLevel");
                            var mp = it.GetProperty("Message") ?? it.GetProperty("message") ?? it.GetProperty("Text") ?? it.GetProperty("text");
                            messages.Add((lp?.GetValue(item)?.ToString() ?? "unknown", mp?.GetValue(item)?.ToString() ?? ""));
                        }
                }
                var cmpMsg = _componentType.GetProperty("RuntimeMessage", BindingFlags.Public | BindingFlags.Instance);
                if (cmpMsg != null)
                {
                    var msg = cmpMsg.GetValue(comp)?.ToString();
                    if (!string.IsNullOrEmpty(msg)) messages.Add(("error", msg));
                }
                return messages.Count > 0;
            }
            catch { return false; }
        }
    }
}
