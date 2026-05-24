using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    public class GhScriptReflector
    {
        private static readonly Lazy<GhScriptReflector> _instance = new(() => new());

        private static readonly Dictionary<string, Guid> ScriptGuids = new()
        {
            { "csharp",  Guid.Parse("b6ba1144-02d6-4a2d-b53c-ec62e290eeb7") },
            { "python", Guid.Parse("719467e6-7cf5-4848-99b0-c5dd57e5442c") },
        };

        private static Type _iScriptCompType;
        private static PropertyInfo _scriptTextProp;

        public IEnumerable<string> SupportedLanguages => ScriptGuids.Keys;

        public static GhScriptReflector Get() => _instance.Value;

        private GhScriptReflector()
        {
            _iScriptCompType = typeof(GH_Component).Assembly.GetTypes()
                .FirstOrDefault(t => t.Name == "IScriptComponent" && t.IsInterface)
                ?? AppDomain.CurrentDomain.GetAssemblies()
                    .SelectMany(a => { try { return a.GetTypes(); } catch { return Array.Empty<Type>(); } })
                    .FirstOrDefault(t => t.Name == "IScriptComponent" && t.IsInterface);
            if (_iScriptCompType != null)
                _scriptTextProp = _iScriptCompType.GetProperty("Text", BindingFlags.Public | BindingFlags.Instance);
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
    }
}
