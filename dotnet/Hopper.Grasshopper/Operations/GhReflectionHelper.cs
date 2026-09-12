using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper.Kernel;

namespace rhino_zmq_poc
{
    internal class GhScriptReflector
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

        /// <summary>
        /// Applies a script param type hint via p.TypeHints.Select(typeof(T)) when available.
        /// Skips when typeHint is null/empty/object (Grasshopper default).
        /// </summary>
        public static void ApplyTypeHint(IGH_Param param, string typeHint)
        {
            if (param == null) return;

            var normalized = NormalizeTypeHint(typeHint);
            if (string.IsNullOrEmpty(normalized) || normalized == "object")
                return;

            var clrType = ResolveClrType(normalized);
            if (clrType == null) return;

            TryTypeHintsSelect(param, clrType);
        }

        public static string GetTypeHintName(IGH_Param param)
        {
            if (param == null) return "object";

            var typeHints = param.GetType().GetProperty("TypeHints", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(param);
            if (typeHints != null)
            {
                foreach (var propName in new[] { "SelectedType", "CurrentType", "Type" })
                {
                    var prop = typeHints.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
                    var value = prop?.GetValue(typeHints);
                    if (value is Type t)
                        return ClrTypeToHintName(t);
                }
            }

            var legacyHint = param.GetType().GetProperty("TypeHint", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(param);
            if (legacyHint != null)
                return legacyHint.GetType().Name.Replace("GH_", "").Replace("Hint", "").Replace("_CS", "").ToLowerInvariant();

            return "object";
        }

        private static string NormalizeTypeHint(string typeHint)
        {
            if (string.IsNullOrWhiteSpace(typeHint)) return "object";

            return typeHint.Trim().ToLowerInvariant() switch
            {
                "number" => "double",
                "text" => "string",
                "float" => "double",
                "str" => "string",
                "boolean" => "bool",
                _ => typeHint.Trim().ToLowerInvariant()
            };
        }

        private static Type ResolveClrType(string hint)
        {
            return hint switch
            {
                "object" => typeof(object),
                "double" => typeof(double),
                "string" => typeof(string),
                "int" => typeof(int),
                "integer" => typeof(int),
                "bool" => typeof(bool),
                "boolean" => typeof(bool),
                _ => Type.GetType(hint, throwOnError: false, ignoreCase: true)
            };
        }

        private static string ClrTypeToHintName(Type type)
        {
            if (type == null || type == typeof(object)) return "object";
            if (type == typeof(double)) return "double";
            if (type == typeof(string)) return "string";
            if (type == typeof(int)) return "int";
            if (type == typeof(bool)) return "bool";
            return type.Name.ToLowerInvariant();
        }

        private static bool TryTypeHintsSelect(IGH_Param param, Type clrType)
        {
            var typeHints = param.GetType().GetProperty("TypeHints", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(param);
            if (typeHints == null) return false;

            var select = typeHints.GetType().GetMethod("Select", BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(Type) }, null);
            if (select == null) return false;

            select.Invoke(typeHints, new object[] { clrType });
            return true;
        }
    }
}
