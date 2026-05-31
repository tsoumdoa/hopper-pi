using System.Drawing;

namespace rhino_zmq_poc
{
  internal static class PluginIcon
  {
    private static Bitmap _bitmap;

    public static Bitmap Bitmap => _bitmap ??= Load();

    private static Bitmap Load()
    {
      using var stream = typeof(PluginIcon).Assembly.GetManifestResourceStream("rhino_zmq_poc.icon.png");
      return stream == null ? null : new Bitmap(stream);
    }
  }
}
