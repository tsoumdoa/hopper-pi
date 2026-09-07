using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace rhino_zmq_poc
{
    // Called on Rhino's command/UI thread. Successful modes survive host restarts.
    internal sealed class RhinoScriptPreloader
    {
        private readonly HashSet<string> ready = new HashSet<string>();
        private bool initializing;

        public void Initialize(Action<string> initialize, Action<string> report)
        {
            if (initializing) return;
            initializing = true;
            try
            {
                foreach (var mode in new[] { "python", "csharp" })
                {
                    if (ready.Contains(mode)) continue;
                    report($"Hopper: initializing {mode}...");
                    var clock = Stopwatch.StartNew();
                    try
                    {
                        initialize(mode);
                        ready.Add(mode);
                        report($"Hopper: {mode} ready ({clock.ElapsedMilliseconds} ms).");
                    }
                    catch (Exception ex)
                    {
                        // Keep the host and the other language usable. Normal script
                        // execution can retry initialization and return diagnostics.
                        report($"Hopper: {mode} initialization failed ({clock.ElapsedMilliseconds} ms). " +
                            $"Script execution can retry.\n{ex}");
                    }
                }
            }
            finally { initializing = false; }
        }
    }
}
