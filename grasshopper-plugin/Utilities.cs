using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;
using Rhino;

namespace rhino_zmq_poc
{
    internal static class Utilities
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

        /// <summary>
        /// Sanitizes a user-supplied string before it is interpolated into a Rhino macro
        /// as a double-quoted argument (e.g. _-SetActiveViewport "{value}"). Strips
        /// control characters (newline/tab injection that would terminate or redirect the
        /// macro) and escapes backslashes and double quotes so the argument cannot break
        /// out of its quotes. Returns null if the input is null/empty/whitespace-only.
        /// </summary>
        public static string SanitizeMacroArgument(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            var sb = new System.Text.StringBuilder(value.Length);
            foreach (var ch in value.Trim())
            {
                if (ch < 0x20)
                    continue;
                if (ch == '\\')
                    sb.Append("\\\\");
                else if (ch == '"')
                    sb.Append("\\\"");
                else
                    sb.Append(ch);
            }
            var result = sb.ToString();
            return result.Length == 0 ? null : result;
        }

        private static readonly TimeSpan DefaultUiTimeout = TimeSpan.FromSeconds(30);

        public static void RunOnUiThread(Action action, TimeSpan? timeout = null)
        {
            RunOnUiThread<bool>(() => { action(); return true; }, timeout);
        }

        public static T RunOnUiThread<T>(Func<T> func, TimeSpan? timeout = null)
        {
            var wait = timeout ?? DefaultUiTimeout;

            if (!RhinoApp.InvokeRequired)
                return func();

            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var completed = 0;

            void ExecuteOnce()
            {
                if (Interlocked.CompareExchange(ref completed, 1, 0) != 0)
                    return;

                try
                {
                    tcs.TrySetResult(func());
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            }

            void PostToUi()
            {
                if (Volatile.Read(ref completed) != 0)
                    return;

                try
                {
                    RhinoApp.InvokeOnUiThread((Action)ExecuteOnce);
                }
                catch
                {
                    // Rhino may not be ready; idle/timer fallbacks will retry.
                }
            }

            PostToUi();

            EventHandler idleHandler = null;
            idleHandler = (_, __) => PostToUi();
            RhinoApp.Idle += idleHandler;

            using var timer = new Timer(_ => PostToUi(), null, 100, 100);

            try
            {
                if (!tcs.Task.Wait(wait))
                    throw new TimeoutException($"RunOnUiThread timed out ({wait.TotalSeconds}s) waiting for UI thread");

                return tcs.Task.Result;
            }
            catch (AggregateException ex) when (ex.InnerException != null)
            {
                throw ex.InnerException;
            }
            finally
            {
                RhinoApp.Idle -= idleHandler;
                Interlocked.Exchange(ref completed, 1);
            }
        }
    }
}