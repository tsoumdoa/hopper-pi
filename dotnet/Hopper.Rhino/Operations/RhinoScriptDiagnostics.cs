using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace rhino_zmq_poc
{
    internal sealed class RhinoScriptDiagnostics
    {
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly List<string> stages = new List<string>();
        private readonly string mode;
        private readonly bool previousRunCompleted;

        public bool? LanguageAvailableBeforeWarmup { get; set; }

        public RhinoScriptDiagnostics(string mode, bool previousRunCompleted)
        {
            this.mode = mode;
            this.previousRunCompleted = previousRunCompleted;
        }

        public void Enter(string stage) => stages.Add($"{stage}@{clock.ElapsedMilliseconds}ms");

        public string Failure(string error) =>
            $"Rhino script diagnostics: mode={mode}; previousRunCompleted={previousRunCompleted}; " +
            $"languageAvailableBeforeWarmup={LanguageAvailableBeforeWarmup?.ToString() ?? "unknown"}; " +
            $"elapsedMs={clock.ElapsedMilliseconds}\n" +
            $"Stages: {string.Join(" -> ", stages)}\n" +
            "Language availability does not establish runtime initialization. Stage names are host calls, not source line numbers.\n" +
            error;

        public static string CollectOutput(params Func<string>[] readers)
        {
            var parts = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var read in readers)
            {
                try
                {
                    var text = read()?.TrimEnd();
                    if (!string.IsNullOrWhiteSpace(text) && seen.Add(text)) parts.Add(text);
                }
                catch (Exception ex)
                {
                    parts.Add($"[Output capture failed: {ex.GetType().Name}: {ex.Message}]");
                }
            }
            return string.Join("\n", parts);
        }
    }
}
