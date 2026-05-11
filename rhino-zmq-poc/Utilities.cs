using System;
using System.Drawing;
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
    }
}