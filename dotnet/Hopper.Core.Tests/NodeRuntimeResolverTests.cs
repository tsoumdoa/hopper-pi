using Hopper.Core;
using Xunit;

namespace Hopper.Core.Tests;

public class NodeRuntimeResolverTests
{
    [Fact]
    public async Task ExplicitEnvironmentPathWinsOverEveryOtherSource()
    {
        var fixture = Fixture();
        fixture.Environment.Values[NodeRuntimeResolver.ExplicitExecutableEnvironmentVariable] = "/explicit/node";
        fixture.FileSystem.AddFile("/explicit/node", executable: true);
        fixture.FileSystem.AddFile("/configured/node", executable: true);
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"nodeExecutable\":\"/configured/node\"}");
        fixture.FileSystem.AddFile("/path/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal("/explicit/node", result.Runtime!.ExecutablePath);
        Assert.Equal(new NodeRuntimeVersion(22, 19, 0), result.Runtime.Version);
        Assert.Equal(NodeRuntimeSource.ExplicitEnvironment, result.Runtime.Source);
        Assert.Equal(["/explicit/node"], fixture.Runner.Requests.Select(request => request.ExecutablePath));
    }

    [Fact]
    public async Task AppDataConfigurationWinsOverPathAndStandardLocations()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"nodeExecutable\":\"/configured/node\"}");
        fixture.FileSystem.AddFile("/configured/node", executable: true);
        fixture.FileSystem.AddFile("/path/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal("/configured/node", result.Runtime!.ExecutablePath);
        Assert.Equal(NodeRuntimeSource.AppDataConfiguration, result.Runtime.Source);
    }

    [Fact]
    public async Task ProcessPathWinsOverStandardLocations()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.FileSystem.AddFile("/standard/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal("/path/node", result.Runtime!.ExecutablePath);
        Assert.Equal(NodeRuntimeSource.ProcessPath, result.Runtime.Source);
    }

    [Fact]
    public async Task StandardLocationIsUsedLast()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/standard/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal("/standard/node", result.Runtime!.ExecutablePath);
        Assert.Equal(NodeRuntimeSource.StandardPath, result.Runtime.Source);
    }

    [Fact]
    public async Task PathSearchSkipsMissingAndNonExecutableCandidates()
    {
        var fixture = Fixture();
        fixture.Paths.ProcessPathCandidates = ["/missing/node", "/blocked/node", "/working/node"];
        fixture.FileSystem.AddFile("/blocked/node", executable: false);
        fixture.FileSystem.AddFile("/working/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal("/working/node", result.Runtime!.ExecutablePath);
    }

    [Theory]
    [InlineData(NodeRuntimeResolver.ExplicitExecutableEnvironmentVariable, "node", NodeRuntimeErrorCode.NodeExplicitPathNotAbsolute)]
    [InlineData(NodeRuntimeResolver.ExplicitExecutableEnvironmentVariable, "./node", NodeRuntimeErrorCode.NodeExplicitPathNotAbsolute)]
    public async Task ExplicitPathMustBeAbsolute(string variable, string value, NodeRuntimeErrorCode expected)
    {
        var fixture = Fixture();
        fixture.Environment.Values[variable] = value;

        await AssertError(fixture, expected);
    }

    [Fact]
    public async Task MissingExplicitPathDoesNotFallBack()
    {
        var fixture = Fixture();
        fixture.Environment.Values[NodeRuntimeResolver.ExplicitExecutableEnvironmentVariable] = "/missing/node";
        fixture.FileSystem.AddFile("/path/node", executable: true);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeExplicitPathNotFound);
        Assert.Empty(fixture.Runner.Requests);
    }

    [Fact]
    public async Task ConfiguredPathMustBeAbsolute()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"nodeExecutable\":\"relative/node\"}");

        await AssertError(fixture, NodeRuntimeErrorCode.NodeConfigPathNotAbsolute);
    }

    [Fact]
    public async Task MissingConfiguredPathDoesNotFallBack()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"nodeExecutable\":\"/missing/node\"}");
        fixture.FileSystem.AddFile("/path/node", executable: true);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeConfigPathNotFound);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"nodeExecutable\":42}")]
    [InlineData("{\"nodeExecutable\":\"  \"}")]
    public async Task MalformedConfigurationReturnsTypedError(string contents)
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: contents);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeConfigMalformed);
    }

    [Fact]
    public async Task ConfigurationWithoutNodeSettingFallsThrough()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"theme\":\"dark\"}");
        fixture.FileSystem.AddFile("/path/node", executable: true);

        var result = await fixture.Resolver.ResolveAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal(NodeRuntimeSource.ProcessPath, result.Runtime!.Source);
    }

    [Fact]
    public async Task ConfigurationReadFailureReturnsTypedError()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath);
        fixture.FileSystem.ReadFailures.Add(fixture.Paths.ConfigFilePath);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeConfigReadFailed);
    }

    [Theory]
    [InlineData(NodeRuntimeSource.ExplicitEnvironment)]
    [InlineData(NodeRuntimeSource.AppDataConfiguration)]
    public async Task ConfiguredFileMustBeExecutable(NodeRuntimeSource source)
    {
        var fixture = Fixture();
        if (source == NodeRuntimeSource.ExplicitEnvironment)
            fixture.Environment.Values[NodeRuntimeResolver.ExplicitExecutableEnvironmentVariable] = "/blocked/node";
        else
            fixture.FileSystem.AddFile(fixture.Paths.ConfigFilePath, contents: "{\"nodeExecutable\":\"/blocked/node\"}");
        fixture.FileSystem.AddFile("/blocked/node", executable: false);

        var result = await AssertError(fixture, NodeRuntimeErrorCode.NodeNotExecutable);
        Assert.Equal(source, result.Error!.Source);
    }

    [Fact]
    public async Task NonExecutableSearchCandidateIsReportedWhenNothingElseExists()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: false);

        var result = await AssertError(fixture, NodeRuntimeErrorCode.NodeNotExecutable);
        Assert.Equal("/path/node", result.Error!.CandidatePath);
    }

    [Fact]
    public async Task MissingNodeReturnsTypedError()
    {
        await AssertError(Fixture(), NodeRuntimeErrorCode.NodeNotFound);
    }

    [Theory]
    [InlineData("v22.19.0", true)]
    [InlineData("22.19.0", true)]
    [InlineData("v22.19.1\n", true)]
    [InlineData("v23.0.0", true)]
    [InlineData("v22.18.999", false)]
    [InlineData("v21.999.999", false)]
    public async Task EnforcesStableMinimumVersion(string output, bool accepted)
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Result = new NodeVersionProcessResult(0, output, "");

        var result = await fixture.Resolver.ResolveAsync();

        Assert.Equal(accepted, result.IsSuccess);
        if (!accepted)
            Assert.Equal(NodeRuntimeErrorCode.NodeVersionUnsupported, result.Error!.Code);
        var request = Assert.Single(fixture.Runner.Requests);
        Assert.Equal(NodeRuntimeResolver.VersionCheckTimeout, request.Timeout);
        Assert.Equal(["--version"], request.Arguments);
        Assert.False(request.UseShell);
    }

    [Theory]
    [InlineData("v23.0.0-rc.1")]
    [InlineData("v22.19.0-nightly20250101")]
    public async Task RejectsPrereleaseVersions(string output)
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Result = new NodeVersionProcessResult(0, output, "");

        await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionPrerelease);
    }

    [Theory]
    [InlineData("")]
    [InlineData("v22")]
    [InlineData("v22.19")]
    [InlineData("v22.19.0.1")]
    [InlineData("v22.x.0")]
    [InlineData("v22.19.0+build")]
    [InlineData("vgarbage-nightly")]
    [InlineData("v+22.19.0")]
    [InlineData("hello")]
    public async Task RejectsMalformedVersions(string output)
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Result = new NodeVersionProcessResult(0, output, "");

        await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionMalformed);
    }

    [Fact]
    public async Task ReportsVersionCheckTimeout()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Result = new NodeVersionProcessResult(null, "", "", TimedOut: true);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionCheckTimeout);
    }

    [Fact]
    public async Task MapsRunnerCancellationToTimeoutWhenCallerDidNotCancel()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Exception = new OperationCanceledException();

        await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionCheckTimeout);
    }

    [Theory]
    [InlineData(1, "bad version", null)]
    [InlineData(null, "", "could not start")]
    public async Task ReportsVersionProcessFailure(int? exitCode, string standardError, string? failure)
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Result = new NodeVersionProcessResult(exitCode, "", standardError, FailureMessage: failure);

        await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionCheckFailed);
    }

    [Fact]
    public async Task ReportsRunnerExceptionAsProcessFailure()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Exception = new InvalidOperationException("process API failed");

        var result = await AssertError(fixture, NodeRuntimeErrorCode.NodeVersionCheckFailed);
        Assert.Contains("process API failed", result.Error!.Message);
    }

    [Fact]
    public async Task CallerCancellationPropagates()
    {
        var fixture = Fixture();
        fixture.FileSystem.AddFile("/path/node", executable: true);
        fixture.Runner.Exception = new OperationCanceledException();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(() => fixture.Resolver.ResolveAsync(cancellation.Token));
    }

    [Fact]
    public void MacPathProviderUsesAppDataPathPathEntriesAndRequiredStandardOrder()
    {
        var environment = new FakeEnvironment(new Dictionary<string, string?> { ["HOME"] = "/Users/test" });
        var paths = new SystemNodeRuntimeOsPathProvider(NodeRuntimeOperatingSystem.MacOS, environment);

        Assert.Equal("/Users/test/Library/Application Support/hopper-pi/config.json", paths.ConfigFilePath);
        Assert.Equal(["/custom/bin/node", "/second/node"], paths.GetProcessPathCandidates("/custom/bin:/second"));
        Assert.Equal(
            ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"],
            paths.GetStandardPathCandidates());
        Assert.True(paths.IsAbsolutePath("/opt/node"));
        Assert.False(paths.IsAbsolutePath("relative/node"));
    }

    [Fact]
    public void WindowsPathProviderUsesAppDataPathEntriesAndRequiredStandardOrder()
    {
        var environment = new FakeEnvironment(new Dictionary<string, string?>
        {
            ["APPDATA"] = @"C:\Users\test\AppData\Roaming",
            ["ProgramFiles"] = @"C:\Program Files",
            ["LocalAppData"] = @"C:\Users\test\AppData\Local",
        });
        var paths = new SystemNodeRuntimeOsPathProvider(NodeRuntimeOperatingSystem.Windows, environment);

        Assert.Equal(@"C:\Users\test\AppData\Roaming\hopper-pi\config.json", paths.ConfigFilePath);
        Assert.Equal(
            [@"C:\Tools\node.exe", @"D:\Node\node.exe"],
            paths.GetProcessPathCandidates("\"C:\\Tools\";D:\\Node"));
        Assert.Equal(
            [@"C:\Program Files\nodejs\node.exe", @"C:\Users\test\AppData\Local\Programs\nodejs\node.exe"],
            paths.GetStandardPathCandidates());
        Assert.True(paths.IsAbsolutePath(@"C:\node\node.exe"));
        Assert.True(paths.IsAbsolutePath(@"\\server\share\node.exe"));
        Assert.False(paths.IsAbsolutePath(@"node\node.exe"));
    }

    private static ResolverFixture Fixture()
    {
        var fileSystem = new FakeFileSystem();
        var environment = new FakeEnvironment(new Dictionary<string, string?>
        {
            [NodeRuntimeResolver.PathEnvironmentVariable] = "/path",
        });
        var paths = new FakePaths();
        var runner = new FakeRunner();
        return new ResolverFixture(
            new NodeRuntimeResolver(fileSystem, environment, paths, runner),
            fileSystem,
            environment,
            paths,
            runner);
    }

    private static async Task<NodeRuntimeResolution> AssertError(
        ResolverFixture fixture,
        NodeRuntimeErrorCode expectedCode)
    {
        var result = await fixture.Resolver.ResolveAsync();
        Assert.False(result.IsSuccess);
        Assert.Null(result.Runtime);
        Assert.Equal(expectedCode, result.Error!.Code);
        return result;
    }

    private sealed record ResolverFixture(
        NodeRuntimeResolver Resolver,
        FakeFileSystem FileSystem,
        FakeEnvironment Environment,
        FakePaths Paths,
        FakeRunner Runner);

    private sealed class FakeFileSystem : INodeRuntimeFileSystem
    {
        private readonly Dictionary<string, FakeFile> _files = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> ReadFailures { get; } = new(StringComparer.OrdinalIgnoreCase);

        public void AddFile(string path, bool executable = false, string contents = "") =>
            _files[path] = new FakeFile(executable, contents);

        public bool FileExists(string path) => _files.ContainsKey(path);
        public bool IsExecutable(string path) => _files.TryGetValue(path, out var file) && file.Executable;
        public string ReadAllText(string path)
        {
            if (ReadFailures.Contains(path))
                throw new IOException("read failed");
            return _files[path].Contents;
        }

        private sealed record FakeFile(bool Executable, string Contents);
    }

    private sealed class FakeEnvironment : INodeRuntimeEnvironment
    {
        public FakeEnvironment(Dictionary<string, string?> values) => Values = values;
        public Dictionary<string, string?> Values { get; }
        public string? GetEnvironmentVariable(string name) => Values.GetValueOrDefault(name);
    }

    private sealed class FakePaths : INodeRuntimeOsPathProvider
    {
        public string ConfigFilePath { get; set; } = "/app-data/config.json";
        public IReadOnlyList<string> ProcessPathCandidates { get; set; } = ["/path/node"];
        public IReadOnlyList<string> StandardPathCandidates { get; set; } = ["/standard/node"];
        public bool IsAbsolutePath(string path) => path.StartsWith('/');
        public string NormalizeAbsolutePath(string path) => path;
        public IReadOnlyList<string> GetProcessPathCandidates(string? pathValue) => ProcessPathCandidates;
        public IReadOnlyList<string> GetStandardPathCandidates() => StandardPathCandidates;
    }

    private sealed class FakeRunner : INodeRuntimeProcessRunner
    {
        public NodeVersionProcessResult Result { get; set; } = new(0, "v22.19.0\n", "");
        public Exception? Exception { get; set; }
        public List<NodeRuntimeProcessRequest> Requests { get; } = [];

        public Task<NodeVersionProcessResult> RunAsync(
            NodeRuntimeProcessRequest request,
            CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Exception is null
                ? Task.FromResult(Result)
                : Task.FromException<NodeVersionProcessResult>(Exception);
        }
    }
}
