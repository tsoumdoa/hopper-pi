using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public sealed class RhinoScriptPreloaderTests
{
    [Fact]
    public void ReopeningOrRestartingDoesNotReloadSuccessfulLanguages()
    {
        var preloader = new RhinoScriptPreloader();
        var calls = new List<string>();
        var messages = new List<string>();
        preloader.Initialize(calls.Add, messages.Add);
        preloader.Initialize(calls.Add, messages.Add);
        Assert.Equal(new[] { "python", "csharp" }, calls);
        Assert.Equal(4, messages.Count);
        Assert.Contains(messages, m => m.StartsWith("Hopper: python ready ("));
        Assert.Contains(messages, m => m.StartsWith("Hopper: csharp ready ("));
    }

    [Fact]
    public void FailureDoesNotBlockOtherLanguageAndOnlyFailedModeIsRetried()
    {
        var preloader = new RhinoScriptPreloader();
        var calls = new List<string>();
        var messages = new List<string>();
        preloader.Initialize(mode =>
        {
            calls.Add(mode);
            if (mode == "python") throw new InvalidOperationException("setup failed");
        }, messages.Add);
        preloader.Initialize(calls.Add, messages.Add);
        Assert.Equal(new[] { "python", "csharp", "python" }, calls);
        Assert.Contains(messages, m => m.Contains("setup failed"));
    }

    [Fact]
    public void ReentrantUiCallbackDoesNotStartDuplicateInitialization()
    {
        var preloader = new RhinoScriptPreloader();
        var calls = new List<string>();
        preloader.Initialize(mode =>
        {
            calls.Add(mode);
            preloader.Initialize(calls.Add, _ => { });
        }, _ => { });
        Assert.Equal(new[] { "python", "csharp" }, calls);
    }
}
