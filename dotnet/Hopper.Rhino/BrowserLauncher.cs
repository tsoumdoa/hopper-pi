using System;
using System.Diagnostics;

namespace rhino_zmq_poc
{
    internal interface IBrowserLauncher
    {
        void Open(Uri uri);
    }

    internal sealed class BrowserLauncher : IBrowserLauncher
    {
        public void Open(Uri uri)
        {
            if (uri == null)
                throw new ArgumentNullException(nameof(uri));

            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri)
                {
                    UseShellExecute = true,
                });
            }
            catch when (OperatingSystem.IsMacOS())
            {
                Process.Start(new ProcessStartInfo("/usr/bin/open")
                {
                    UseShellExecute = false,
                    ArgumentList = { uri.AbsoluteUri },
                });
            }
        }
    }
}
