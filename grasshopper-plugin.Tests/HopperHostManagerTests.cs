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
    public void ReadyLineAcceptsOwnedLoopbackHost()
    {
        var ok = HostReadiness.TryParse(
            "{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42}",
            42,
            out var uri);

        Assert.True(ok);
        Assert.Equal("http://127.0.0.1:43821", uri.GetLeftPart(UriPartial.Authority));
    }

    [Theory]
    [InlineData("{\"type\":\"ready\",\"url\":\"https://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://localhost:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://example.com:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":43}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\"}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":\"42\"}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/\",\"pid\":42}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/?x=1#abcdefghijklmnopqrstuvwxyz012345\",\"pid\":42}")]
    [InlineData("{\"type\":\"ready\",\"url\":\"http://127.0.0.1:43821/#bad/token\",\"pid\":42}")]
    [InlineData("not json")]
    public void ReadyLineRejectsUnsafeOrUnownedValues(string line)
    {
        Assert.False(HostReadiness.TryParse(line, 42, out _));
    }
}
