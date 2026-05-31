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

        /// <summary>Maps API textOutput to GH_Panel.Properties.Multiline.</summary>
        public static string TryResolvePanelMultiline(string textOutput, out bool multiline)
        {
            multiline = false;
            if (string.IsNullOrEmpty(textOutput))
                return "textOutput is required (singleString or oneItemPerLine)";
            switch (textOutput)
            {
                case "singleString":
                    multiline = true;
                    return null;
                case "oneItemPerLine":
                    multiline = false;
                    return null;
                default:
                    return $"invalid textOutput '{textOutput}' (expected 'singleString' or 'oneItemPerLine')";
            }
        }

        private static readonly TimeSpan DefaultUiTimeout = TimeSpan.FromSeconds(30);

        public static void RunOnUiThread(Action action, TimeSpan? timeout = null)
        {
            RunOnUiThread<bool>(() => { action(); return true; }, timeout);
        }

        public static T RunOnUiThread<T>(Func<T> func, TimeSpan? timeout = null)
        {
            var wait = timeout ?? DefaultUiTimeout;
            var tcs = new TaskCompletionSource<T>();
            EventHandler handler = null;
            var idleFired = false;

            handler = (s, a) =>
            {
                idleFired = true;
                RhinoApp.Idle -= handler;
                try
                {
                    tcs.SetResult(func());
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            };

            RhinoApp.Idle += handler;

            try
            {
                tcs.Task.Wait(wait);
            }
            catch (AggregateException)
            {
                RhinoApp.Idle -= handler;
                throw;
            }

            if (tcs.Task.IsCompleted)
                return tcs.Task.Result;

            RhinoApp.Idle -= handler;
            var phase = idleFired ? "executing on UI thread" : "waiting for RhinoApp.Idle";
            throw new TimeoutException($"RunOnUiThread timed out ({wait.TotalSeconds}s) while {phase}");
        }
    }
}