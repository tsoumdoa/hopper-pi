using System.Reflection;
using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public sealed class RhinoLanguageWarmupTests
{
    [Fact]
    public void ColdRuntimeLoadsPluginThenResolvesTypesAgain()
    {
        var loaded = false;
        var events = new List<string>();
        RhinoCodeRunner.EnsureRuntimeAvailable(
            () => { events.Add("resolve"); return loaded; },
            () => { events.Add("load"); loaded = true; return true; });
        Assert.Equal(new[] { "resolve", "load", "resolve" }, events);

        RhinoCodeRunner.EnsureRuntimeAvailable(() => loaded,
            () => throw new Exception("An available runtime must not load the plugin again"));
    }

    [Fact]
    public void BootstrapFailureDoesNotSuppressALaterAttempt()
    {
        var loaded = false;
        var failure = Assert.Throws<InvalidOperationException>(() =>
            RhinoCodeRunner.EnsureRuntimeAvailable(() => loaded, () => false));
        Assert.Contains("plugin could not be loaded", failure.Message);
        RhinoCodeRunner.EnsureRuntimeAvailable(() => loaded, () => loaded = true);
        Assert.True(loaded);
    }

    [Fact]
    public void SuccessfulPluginLoadStillRequiresRuntimeTypes()
    {
        var failure = Assert.Throws<InvalidOperationException>(() =>
            RhinoCodeRunner.EnsureRuntimeAvailable(() => false, () => true));
        Assert.Contains("unavailable after loading", failure.Message);
    }

    [Fact]
    public void CompletedButErroredLanguageIsNotCachedAndPreservesDiagnostics()
    {
        var registry = new Registry();
        var mode = Guid.NewGuid().ToString();
        var starts = 0;
        registry.Language.State.IsReady = false;
        registry.Language.State.IsErrored = true;
        registry.Language.State.Progress.Message = "Python initialization failed";
        registry.Language.State.Progress.Diagnostics = new[] { "Runtime download failed: connection refused" };

        bool Ensure() => RhinoCodeRunner.EnsureLanguageReady(mode, registry, typeof(Spec), new Spec(mode),
            typeof(Registry).GetMethod(nameof(Registry.QueryLatest))!, () => starts++);

        // Rhino's status wait returns normally for errored languages.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var failure = Assert.Throws<InvalidOperationException>(() => Ensure());
            Assert.Contains("Python initialization failed", failure.Message);
            Assert.Contains("Runtime download failed: connection refused", failure.Message);
        }
        Assert.Equal(2, starts);
        Assert.Equal(2, registry.StatusWaits);

        registry.Language.State.IsReady = true;
        registry.Language.State.IsErrored = false;
        Assert.True(Ensure());
        Assert.True(Ensure());
        Assert.Equal(3, starts);
        Assert.Equal(3, registry.StatusWaits);

        // A cached language can become errored while remaining registered.
        registry.Language.State.IsReady = false;
        registry.Language.State.IsErrored = true;
        Assert.Throws<InvalidOperationException>(() => Ensure());
        Assert.Equal(4, starts);
        Assert.Equal(4, registry.StatusWaits);
    }

    [Fact]
    public void RegisteredLanguageWithoutReadyStatusCannotBeCached()
    {
        var registry = new Registry();
        registry.Language.State.IsReady = false;
        var failure = Assert.Throws<InvalidOperationException>(() =>
            RhinoCodeRunner.EnsureLanguageReady(Guid.NewGuid().ToString(), registry, typeof(Spec), new Spec("python"),
                typeof(Registry).GetMethod(nameof(Registry.QueryLatest))!, () => { }));
        Assert.Contains("did not become ready", failure.Message);
    }

    [Theory]
    [InlineData("python", "mcneel.pythonnet.python")]
    [InlineData("csharp", "mcneel.roslyn.csharp")]
    public void MissingStaticLanguagePropertiesStillResolveRequestedMode(string mode, string expectedId)
    {
        var resolver = typeof(RhinoCodeRunner).GetMethod("ResolveLanguageSpec", BindingFlags.NonPublic | BindingFlags.Static)!;
        var spec = (Spec)resolver.Invoke(null, new object[] { typeof(Spec), mode, "" })!;
        Assert.Equal(expectedId, spec.Mode);
    }

    [Theory]
    [InlineData("python")]
    [InlineData("csharp")]
    public void WaitLoadsAndReadiesLanguageWithoutCallingNullReporterOverload(string mode)
    {
        var registry = new Registry();
        var spec = new Spec(mode);
        RhinoCodeRunner.WaitForLanguage(registry, typeof(Spec), spec);
        Assert.Same(spec, registry.ReadySpec);
        Assert.Equal(1, registry.StatusWaits);
        Assert.Equal(0, registry.LoadWaits);

        // A repeated wait must also avoid the reporter overload, which still
        // reports completion even when no loaders remain.
        RhinoCodeRunner.WaitForLanguage(registry, typeof(Spec), spec);
        Assert.Equal(2, registry.StatusWaits);
        Assert.Equal(0, registry.LoadWaits);
    }

    [Fact]
    public void InitializationFailureIsPreservedAndNotRetried()
    {
        var registry = new Registry { Failure = new InvalidOperationException("initialization failed") };
        var error = Assert.Throws<TargetInvocationException>(() =>
            RhinoCodeRunner.WaitForLanguage(registry, typeof(Spec), new Spec("python")));
        Assert.Same(registry.Failure, error.InnerException);
        Assert.Equal(1, registry.StatusWaits);
        Assert.Equal(0, registry.LoadWaits);
        Assert.Null(registry.ReadySpec);
    }

    [Fact]
    public void MissingStatusWaitFailsExplicitly()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            RhinoCodeRunner.WaitForLanguage(new object(), typeof(Spec), new Spec("python")));
        Assert.Contains("readiness could not be established", error.Message);
    }

    public sealed record Spec(string Mode);

    public interface ILanguage
    {
        Status Status { get; }
    }

    public sealed class Language : ILanguage
    {
        public Status State { get; } = new();
        Status ILanguage.Status => State;
    }

    public sealed class Status
    {
        public bool IsReady { get; set; } = true;
        public bool IsErrored { get; set; }
        public Progress Progress { get; } = new();
    }

    public sealed class Progress
    {
        public string Message { get; set; } = "";
        public string[] Diagnostics { get; set; } = Array.Empty<string>();
    }

    public sealed class Registry
    {
        public interface ILanguageLoadReporter { void Complete(); }
        public Spec? ReadySpec { get; private set; }
        public int StatusWaits { get; private set; }
        public int LoadWaits { get; private set; }
        public Exception? Failure { get; init; }
        public Language Language { get; } = new();

        public Language QueryLatest(Spec spec) => Language;

        public void WaitStatusComplete(Spec spec)
        {
            StatusWaits++;
            if (Failure != null) throw Failure;
            ReadySpec = spec;
        }

        public void WaitLoadComplete(Spec spec, ILanguageLoadReporter reporter)
        {
            LoadWaits++;
            reporter.Complete();
        }
    }
}
