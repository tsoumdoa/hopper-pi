using System.Reflection;
using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public sealed class RhinoLanguageWarmupTests
{
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

    public sealed class Registry
    {
        public interface ILanguageLoadReporter { void Complete(); }
        public Spec? ReadySpec { get; private set; }
        public int StatusWaits { get; private set; }
        public int LoadWaits { get; private set; }
        public Exception? Failure { get; init; }

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
