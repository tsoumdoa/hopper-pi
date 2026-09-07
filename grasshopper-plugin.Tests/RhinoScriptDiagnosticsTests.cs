using System.Reflection;
using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public sealed class RhinoScriptDiagnosticsTests
{
    [Fact]
    public void FailurePreservesNestedExceptionStackAndObservedStages()
    {
        var failure = new TargetInvocationException(Assert.Throws<NullReferenceException>(ThrowFromScript));
        var diagnostics = new RhinoScriptDiagnostics("python", false);
        diagnostics.Enter("document-context");
        var format = typeof(RhinoCodeRunner).GetMethod("FormatException", BindingFlags.NonPublic | BindingFlags.Static)!;
        var text = diagnostics.Failure((string)format.Invoke(null, new object[] { failure })!);
        Assert.Contains("languageAvailableBeforeWarmup=unknown", text);
        Assert.Contains("previousRunCompleted=False", text);
        Assert.Contains("document-context@", text);
        Assert.Contains("TargetInvocationException", text);
        Assert.Contains("NullReferenceException: script failure", text);
        Assert.Contains(nameof(ThrowFromScript), text);
    }

    [Fact]
    public void FailedContextReadStillCapturesStreamAndLoadingMessages()
    {
        var text = RhinoScriptDiagnostics.CollectOutput(
            () => "before failure\n",
            () => throw new InvalidOperationException("getter failed"),
            () => "Loading Python 3 (50%)");
        Assert.Contains("before failure", text);
        Assert.Contains("getter failed", text);
        Assert.Contains("Loading Python 3 (50%)", text);
    }

    private static void ThrowFromScript() => throw new NullReferenceException("script failure");
}
