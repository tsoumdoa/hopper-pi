using rhino_zmq_poc;
using Xunit;

namespace rhino_zmq_poc.Tests;

public class HopperHostManagerTests
{
    [Fact]
    public void PackagedRuntimePathMustBeRelativeAndContained()
    {
        var packageDirectory = Path.Combine(Path.GetTempPath(), $"hopper-manifest-{Guid.NewGuid():N}");
        Directory.CreateDirectory(packageDirectory);
        try
        {
            var runtimeFile = Path.Combine(packageDirectory, "node", "bin", "node");
            Directory.CreateDirectory(Path.GetDirectoryName(runtimeFile)!);
            File.WriteAllText(runtimeFile, "runtime");

            Assert.Equal(runtimeFile, RuntimeManifestPaths.ResolveFile("node/bin/node", packageDirectory));
            Assert.Null(RuntimeManifestPaths.ResolveFile(runtimeFile, packageDirectory));
            Assert.Null(RuntimeManifestPaths.ResolveFile("../node", packageDirectory));
        }
        finally
        {
            Directory.Delete(packageDirectory, recursive: true);
        }
    }

    [Fact]
    public void VersionTwoManifestResolvesHostEntryInsideRuntimeDirectory()
    {
        var runtimeDirectory = Path.Combine(Path.GetTempPath(), $"hopper-runtime-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(runtimeDirectory, "host", "dist", "host"));
        try
        {
            var entry = Path.Combine(runtimeDirectory, "host", "dist", "host", "index.js");
            File.WriteAllText(entry, "runtime");
            var manifest = Path.Combine(runtimeDirectory, "hopper-runtime.json");
            File.WriteAllText(manifest,
                "{\"protocolVersion\":2,\"hostEntry\":\"host/dist/host/index.js\"}");

            Assert.Equal(entry, RuntimeManifestPaths.ResolveHostEntry(manifest));

            File.WriteAllText(manifest,
                "{\"protocolVersion\":2,\"hostEntry\":\"../outside.js\"}");
            Assert.Null(RuntimeManifestPaths.ResolveHostEntry(manifest));
        }
        finally
        {
            Directory.Delete(runtimeDirectory, recursive: true);
        }
    }

    [Fact]
    public void ReadyLineAcceptsOwnedLoopbackHost()
    {
        var ok = HostReadiness.TryParse(
            "{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":true}",
            42,
            "life-1",
            out var uri);

        Assert.True(ok);
        Assert.Equal("http://127.0.0.1:43821", uri.GetLeftPart(UriPartial.Authority));
    }

    [Theory]
    [InlineData("{\"type\":\"ready\",\"url\":\"https://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":true}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":43,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":true}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42,\"lifecycleInstanceId\":\"life-old\",\"protocolHandshakeLive\":true}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":false}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42,\"lifecycleInstanceId\":\"life-1\"}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#bad/token\",\"pid\":42,\"lifecycleInstanceId\":\"life-1\",\"protocolHandshakeLive\":true}")]
    [InlineData("not json")]
    public void ReadyLineRejectsUnsafeOrUnownedValues(string line)
    {
        Assert.False(HostReadiness.TryParse(line, 42, "life-1", out _));
    }
}
