using System;
using System.Reflection;

namespace rhino_zmq_poc
{
    internal static partial class RhinoCodeRunner
    {
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
