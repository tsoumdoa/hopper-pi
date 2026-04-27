using System;
using System.Drawing;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;
using Rhino;

namespace rhino_zmq_poc
{
    public static class Utilities
    {
        public static Color ParseRgbaColor(string rgba, Color fallback = default)
        {
            if (string.IsNullOrEmpty(rgba)) return fallback == default ? Color.White : fallback;
            try
            {
                var inner = rgba.Replace("rgba(", "").Replace(")", "");
                var parts = inner.Split(',');
                if (parts.Length >= 3 &&
                    int.TryParse(parts[0].Trim(), out int r) &&
                    int.TryParse(parts[1].Trim(), out int g) &&
                    int.TryParse(parts[2].Trim(), out int b))
                {
                    var a = parts.Length > 3 && int.TryParse(parts[3].Trim(), out int alpha) ? alpha : 255;
                    return Color.FromArgb(a, r, g, b);
                }
            }
            catch (Exception ex)
            {
                RhinoApp.WriteLine($"[Utilities] ParseRgbaColor failed: {ex.Message}");
            }
            return fallback == default ? Color.White : fallback;
        }

        public static GH_GroupBorder ParseGroupBorder(string borderStr, GH_GroupBorder fallback)
        {
            if (string.IsNullOrEmpty(borderStr)) return fallback;
            return borderStr.ToLowerInvariant() switch
            {
                "box" => GH_GroupBorder.Box,
                "blob" => GH_GroupBorder.Blob,
                "rectangle" => GH_GroupBorder.Rectangles,
                _ => fallback
            };
        }

        public static string AccessStr(GH_ParamAccess a) => a switch
        {
            GH_ParamAccess.item => "item",
            GH_ParamAccess.list => "list",
            GH_ParamAccess.tree => "tree",
            _ => a.ToString()
        };

        public static string MappingStr(GH_DataMapping m) => m switch
        {
            GH_DataMapping.None => "none",
            GH_DataMapping.Flatten => "flatten",
            GH_DataMapping.Graft => "graft",
            _ => m.ToString()
        };

        public static void RunOnUiThread(Action action)
        {
            RunOnUiThread<bool>(() => { action(); return true; });
        }

        public static T RunOnUiThread<T>(Func<T> func)
        {
            var tcs = new TaskCompletionSource<T>();
            RhinoApp.Idle += OnIdle;

            void OnIdle(object s, EventArgs a)
            {
                RhinoApp.Idle -= OnIdle;
                try
                {
                    tcs.SetResult(func());
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            }

            return tcs.Task.GetAwaiter().GetResult();
        }
    }
}