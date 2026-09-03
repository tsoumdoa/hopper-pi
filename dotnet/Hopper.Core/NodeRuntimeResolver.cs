using System.Text.Json;

namespace Hopper.Core;

public enum NodeRuntimeSource
{
    ExplicitEnvironment,
    AppDataConfiguration,
    ProcessPath,
    StandardPath,
}

public enum NodeRuntimeErrorCode
{
    NodeNotFound,
    NodeExplicitPathNotAbsolute,
    NodeExplicitPathNotFound,
    NodeConfigPathNotAbsolute,
    NodeConfigPathNotFound,
    NodeConfigMalformed,
    NodeConfigReadFailed,
    NodeNotExecutable,
    NodeVersionMalformed,
    NodeVersionPrerelease,
    NodeVersionUnsupported,
    NodeVersionCheckTimeout,
    NodeVersionCheckFailed,
}

public readonly record struct NodeRuntimeVersion(int Major, int Minor, int Patch) : IComparable<NodeRuntimeVersion>
{
    public int CompareTo(NodeRuntimeVersion other)
    {
        var major = Major.CompareTo(other.Major);
        if (major != 0)
            return major;
        var minor = Minor.CompareTo(other.Minor);
        return minor != 0 ? minor : Patch.CompareTo(other.Patch);
    }

    public override string ToString() => $"{Major}.{Minor}.{Patch}";
}

public sealed record NodeRuntime(string ExecutablePath, NodeRuntimeVersion Version, NodeRuntimeSource Source);

public sealed record NodeRuntimeError(
    NodeRuntimeErrorCode Code,
    string Message,
    string? CandidatePath = null,
    NodeRuntimeSource? Source = null);

public sealed class NodeRuntimeResolution
{
    private NodeRuntimeResolution(NodeRuntime? runtime, NodeRuntimeError? error)
    {
        Runtime = runtime;
        Error = error;
    }

    public bool IsSuccess => Runtime is not null;
    public NodeRuntime? Runtime { get; }
    public NodeRuntimeError? Error { get; }

    public static NodeRuntimeResolution Success(NodeRuntime runtime) => new(runtime, null);
    public static NodeRuntimeResolution Failure(NodeRuntimeError error) => new(null, error);
}

public interface INodeRuntimeFileSystem
{
    bool FileExists(string path);
    bool IsExecutable(string path);
    string ReadAllText(string path);
}

public interface INodeRuntimeEnvironment
{
    string? GetEnvironmentVariable(string name);
}

public interface INodeRuntimeOsPathProvider
{
    string ConfigFilePath { get; }
    bool IsAbsolutePath(string path);
    string NormalizeAbsolutePath(string path);
    IReadOnlyList<string> GetProcessPathCandidates(string? pathValue);
    IReadOnlyList<string> GetStandardPathCandidates();
}

public sealed record NodeVersionProcessResult(
    int? ExitCode,
    string StandardOutput,
    string StandardError,
    bool TimedOut = false,
    string? FailureMessage = null);

public sealed record NodeRuntimeProcessRequest(
    string ExecutablePath,
    IReadOnlyList<string> Arguments,
    TimeSpan Timeout,
    bool UseShell);

public interface INodeRuntimeProcessRunner
{
    Task<NodeVersionProcessResult> RunAsync(
        NodeRuntimeProcessRequest request,
        CancellationToken cancellationToken);
}

public interface INodeRuntimeProvider
{
    Task<NodeRuntimeResolution> ResolveAsync(CancellationToken cancellationToken = default);
}

public sealed class NodeRuntimeResolver : INodeRuntimeProvider
{
    public const string ExplicitExecutableEnvironmentVariable = "HOPPER_NODE_EXECUTABLE";
    public const string PathEnvironmentVariable = "PATH";
    public static readonly NodeRuntimeVersion MinimumVersion = new(22, 19, 0);
    public static readonly TimeSpan VersionCheckTimeout = TimeSpan.FromSeconds(3);

    private readonly INodeRuntimeFileSystem _fileSystem;
    private readonly INodeRuntimeEnvironment _environment;
    private readonly INodeRuntimeOsPathProvider _paths;
    private readonly INodeRuntimeProcessRunner _processRunner;

    public NodeRuntimeResolver(
        INodeRuntimeFileSystem fileSystem,
        INodeRuntimeEnvironment environment,
        INodeRuntimeOsPathProvider paths,
        INodeRuntimeProcessRunner processRunner)
    {
        _fileSystem = fileSystem ?? throw new ArgumentNullException(nameof(fileSystem));
        _environment = environment ?? throw new ArgumentNullException(nameof(environment));
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _processRunner = processRunner ?? throw new ArgumentNullException(nameof(processRunner));
    }

    public async Task<NodeRuntimeResolution> ResolveAsync(CancellationToken cancellationToken = default)
    {
        var explicitPath = NonEmpty(_environment.GetEnvironmentVariable(ExplicitExecutableEnvironmentVariable));
        if (explicitPath is not null)
        {
            if (!_paths.IsAbsolutePath(explicitPath))
            {
                return Failure(
                    NodeRuntimeErrorCode.NodeExplicitPathNotAbsolute,
                    $"{ExplicitExecutableEnvironmentVariable} must be an absolute path.",
                    explicitPath,
                    NodeRuntimeSource.ExplicitEnvironment);
            }

            return await ValidateCandidateAsync(
                explicitPath,
                NodeRuntimeSource.ExplicitEnvironment,
                NodeRuntimeErrorCode.NodeExplicitPathNotFound,
                cancellationToken).ConfigureAwait(false);
        }

        var configuredPathResult = ReadConfiguredPath();
        if (configuredPathResult.Error is not null)
            return NodeRuntimeResolution.Failure(configuredPathResult.Error);
        if (configuredPathResult.Path is not null)
        {
            if (!_paths.IsAbsolutePath(configuredPathResult.Path))
            {
                return Failure(
                    NodeRuntimeErrorCode.NodeConfigPathNotAbsolute,
                    $"nodeExecutable in {_paths.ConfigFilePath} must be an absolute path.",
                    configuredPathResult.Path,
                    NodeRuntimeSource.AppDataConfiguration);
            }

            return await ValidateCandidateAsync(
                configuredPathResult.Path,
                NodeRuntimeSource.AppDataConfiguration,
                NodeRuntimeErrorCode.NodeConfigPathNotFound,
                cancellationToken).ConfigureAwait(false);
        }

        string? firstNonExecutable = null;
        foreach (var sourceAndCandidates in new[]
        {
            (
                Source: NodeRuntimeSource.ProcessPath,
                Candidates: _paths.GetProcessPathCandidates(_environment.GetEnvironmentVariable(PathEnvironmentVariable))
            ),
            (Source: NodeRuntimeSource.StandardPath, Candidates: _paths.GetStandardPathCandidates()),
        })
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var rawCandidate in sourceAndCandidates.Candidates)
            {
                if (string.IsNullOrWhiteSpace(rawCandidate) || !_paths.IsAbsolutePath(rawCandidate))
                    continue;
                var candidate = _paths.NormalizeAbsolutePath(rawCandidate);
                if (!seen.Add(candidate) || !_fileSystem.FileExists(candidate))
                    continue;
                if (!_fileSystem.IsExecutable(candidate))
                {
                    firstNonExecutable ??= candidate;
                    continue;
                }

                return await CheckVersionAsync(candidate, sourceAndCandidates.Source, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        if (firstNonExecutable is not null)
        {
            return Failure(
                NodeRuntimeErrorCode.NodeNotExecutable,
                $"Node was found at {firstNonExecutable}, but it is not executable.",
                firstNonExecutable);
        }

        return Failure(
            NodeRuntimeErrorCode.NodeNotFound,
            "Node 22.19.0 or newer was not found. Configure an absolute nodeExecutable path or install Node in a standard location.");
    }

    private ConfiguredPathResult ReadConfiguredPath()
    {
        if (!_fileSystem.FileExists(_paths.ConfigFilePath))
            return new ConfiguredPathResult(null, null);

        string json;
        try
        {
            json = _fileSystem.ReadAllText(_paths.ConfigFilePath);
        }
        catch (Exception exception)
        {
            return new ConfiguredPathResult(null, new NodeRuntimeError(
                NodeRuntimeErrorCode.NodeConfigReadFailed,
                $"Could not read Node configuration at {_paths.ConfigFilePath}: {exception.Message}",
                _paths.ConfigFilePath,
                NodeRuntimeSource.AppDataConfiguration));
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                return MalformedConfig("the root value must be an object");
            if (!document.RootElement.TryGetProperty("nodeExecutable", out var property))
                return new ConfiguredPathResult(null, null);
            if (property.ValueKind != JsonValueKind.String || NonEmpty(property.GetString()) is not { } path)
                return MalformedConfig("nodeExecutable must be a non-empty string");
            return new ConfiguredPathResult(path, null);
        }
        catch (JsonException exception)
        {
            return MalformedConfig(exception.Message);
        }
    }

    private ConfiguredPathResult MalformedConfig(string detail) => new(null, new NodeRuntimeError(
        NodeRuntimeErrorCode.NodeConfigMalformed,
        $"Node configuration at {_paths.ConfigFilePath} is malformed: {detail}",
        _paths.ConfigFilePath,
        NodeRuntimeSource.AppDataConfiguration));

    private async Task<NodeRuntimeResolution> ValidateCandidateAsync(
        string rawPath,
        NodeRuntimeSource source,
        NodeRuntimeErrorCode missingCode,
        CancellationToken cancellationToken)
    {
        var path = _paths.NormalizeAbsolutePath(rawPath);
        if (!_fileSystem.FileExists(path))
        {
            return Failure(
                missingCode,
                $"The configured Node executable does not exist: {path}",
                path,
                source);
        }
        if (!_fileSystem.IsExecutable(path))
        {
            return Failure(
                NodeRuntimeErrorCode.NodeNotExecutable,
                $"The configured Node file is not executable: {path}",
                path,
                source);
        }
        return await CheckVersionAsync(path, source, cancellationToken).ConfigureAwait(false);
    }

    private async Task<NodeRuntimeResolution> CheckVersionAsync(
        string path,
        NodeRuntimeSource source,
        CancellationToken cancellationToken)
    {
        NodeVersionProcessResult processResult;
        try
        {
            processResult = await _processRunner.RunAsync(
                    new NodeRuntimeProcessRequest(path, new[] { "--version" }, VersionCheckTimeout, UseShell: false),
                    cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionCheckTimeout,
                $"Node version check timed out after {VersionCheckTimeout.TotalSeconds:0} seconds.",
                path,
                source);
        }
        catch (Exception exception)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionCheckFailed,
                $"Could not run '{path} --version': {exception.Message}",
                path,
                source);
        }

        if (processResult.TimedOut)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionCheckTimeout,
                $"Node version check timed out after {VersionCheckTimeout.TotalSeconds:0} seconds.",
                path,
                source);
        }
        if (NonEmpty(processResult.FailureMessage) is not null || processResult.ExitCode is null or not 0)
        {
            var detail = NonEmpty(processResult.FailureMessage)
                ?? NonEmpty(processResult.StandardError)
                ?? $"exit code {processResult.ExitCode?.ToString() ?? "unknown"}";
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionCheckFailed,
                $"Could not run '{path} --version': {detail}",
                path,
                source);
        }

        var versionText = processResult.StandardOutput.Trim();
        var parsed = ParseVersion(versionText);
        if (parsed.Prerelease)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionPrerelease,
                $"Prerelease Node versions are not supported: {versionText}",
                path,
                source);
        }
        if (parsed.Version is null)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionMalformed,
                $"Node returned an unrecognized version: {versionText}",
                path,
                source);
        }
        if (parsed.Version.Value.CompareTo(MinimumVersion) < 0)
        {
            return VersionFailure(
                NodeRuntimeErrorCode.NodeVersionUnsupported,
                $"Node {parsed.Version.Value} is unsupported. HopperCode requires Node {MinimumVersion} or newer.",
                path,
                source);
        }

        return NodeRuntimeResolution.Success(new NodeRuntime(path, parsed.Version.Value, source));
    }

    private static ParsedVersion ParseVersion(string text)
    {
        var value = text.StartsWith('v') ? text[1..] : text;
        var dash = value.IndexOf('-');
        var stablePart = dash >= 0 ? value[..dash] : value;
        var parts = stablePart.Split('.');
        if (parts.Length != 3
            || parts.Any(part => part.Length == 0 || part.Any(character => !char.IsAsciiDigit(character)))
            || !int.TryParse(parts[0], out var major)
            || !int.TryParse(parts[1], out var minor)
            || !int.TryParse(parts[2], out var patch)
            || major < 0
            || minor < 0
            || patch < 0)
        {
            return new ParsedVersion(null, Prerelease: false);
        }
        if (dash >= 0)
            return new ParsedVersion(null, Prerelease: true);
        return new ParsedVersion(new NodeRuntimeVersion(major, minor, patch), Prerelease: false);
    }

    private static string? NonEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static NodeRuntimeResolution Failure(
        NodeRuntimeErrorCode code,
        string message,
        string? path = null,
        NodeRuntimeSource? source = null) =>
        NodeRuntimeResolution.Failure(new NodeRuntimeError(code, message, path, source));

    private static NodeRuntimeResolution VersionFailure(
        NodeRuntimeErrorCode code,
        string message,
        string path,
        NodeRuntimeSource source) => Failure(code, message, path, source);

    private sealed record ConfiguredPathResult(string? Path, NodeRuntimeError? Error);
    private readonly record struct ParsedVersion(NodeRuntimeVersion? Version, bool Prerelease);
}

public sealed class SystemNodeRuntimeFileSystem : INodeRuntimeFileSystem
{
    public bool FileExists(string path) => File.Exists(path);

    public bool IsExecutable(string path)
    {
        if (!File.Exists(path))
            return false;
        if (OperatingSystem.IsWindows())
            return true;
        try
        {
            var mode = File.GetUnixFileMode(path);
            const UnixFileMode execute = UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;
            return (mode & execute) != 0;
        }
        catch (PlatformNotSupportedException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
        catch (IOException)
        {
            return false;
        }
    }

    public string ReadAllText(string path) => File.ReadAllText(path);
}

public sealed class SystemNodeRuntimeEnvironment : INodeRuntimeEnvironment
{
    public string? GetEnvironmentVariable(string name) => Environment.GetEnvironmentVariable(name);
}

public enum NodeRuntimeOperatingSystem
{
    MacOS,
    Windows,
}

public sealed class SystemNodeRuntimeOsPathProvider : INodeRuntimeOsPathProvider
{
    private readonly NodeRuntimeOperatingSystem _operatingSystem;
    private readonly char _pathSeparator;
    private readonly char _directorySeparator;
    private readonly string _executableName;
    private readonly string[] _standardPaths;

    public SystemNodeRuntimeOsPathProvider(
        NodeRuntimeOperatingSystem operatingSystem,
        INodeRuntimeEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);
        _operatingSystem = operatingSystem;
        _pathSeparator = operatingSystem == NodeRuntimeOperatingSystem.Windows ? ';' : ':';
        _directorySeparator = operatingSystem == NodeRuntimeOperatingSystem.Windows ? '\\' : '/';
        _executableName = operatingSystem == NodeRuntimeOperatingSystem.Windows ? "node.exe" : "node";

        if (operatingSystem == NodeRuntimeOperatingSystem.Windows)
        {
            var userProfile = NonEmpty(environment.GetEnvironmentVariable("USERPROFILE"));
            var appData = NonEmpty(environment.GetEnvironmentVariable("APPDATA"))
                ?? (userProfile is null ? null : Join(userProfile, "AppData", "Roaming"));
            ConfigFilePath = appData is null ? Join("C:\\", "hopper-pi", "config.json") : Join(appData, "hopper-pi", "config.json");
            _standardPaths = new[]
            {
                Candidate(environment.GetEnvironmentVariable("ProgramFiles"), "nodejs", "node.exe"),
                Candidate(environment.GetEnvironmentVariable("LocalAppData"), "Programs", "nodejs", "node.exe"),
            }.Where(path => path is not null).Cast<string>().ToArray();
        }
        else
        {
            var home = NonEmpty(environment.GetEnvironmentVariable("HOME")) ?? "/";
            ConfigFilePath = Join(home, "Library", "Application Support", "hopper-pi", "config.json");
            _standardPaths = new[]
            {
                "/opt/homebrew/bin/node",
                "/usr/local/bin/node",
                "/usr/bin/node",
            };
        }
    }

    public string ConfigFilePath { get; }

    public static SystemNodeRuntimeOsPathProvider ForCurrentOperatingSystem(INodeRuntimeEnvironment environment)
    {
        if (OperatingSystem.IsWindows())
            return new SystemNodeRuntimeOsPathProvider(NodeRuntimeOperatingSystem.Windows, environment);
        if (OperatingSystem.IsMacOS())
            return new SystemNodeRuntimeOsPathProvider(NodeRuntimeOperatingSystem.MacOS, environment);
        throw new PlatformNotSupportedException("HopperCode supports external Node resolution on macOS and Windows.");
    }

    public bool IsAbsolutePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;
        if (_operatingSystem == NodeRuntimeOperatingSystem.MacOS)
            return path.StartsWith('/');
        return (
                path.Length >= 3
                && char.IsAsciiLetter(path[0])
                && path[1] == ':'
                && IsDirectorySeparator(path[2]))
            || (path.Length >= 2 && IsDirectorySeparator(path[0]) && IsDirectorySeparator(path[1]));
    }

    public string NormalizeAbsolutePath(string path)
    {
        var normalized = path.Trim();
        if (_operatingSystem == NodeRuntimeOperatingSystem.Windows)
            normalized = normalized.Replace('/', '\\');
        return normalized;
    }

    public IReadOnlyList<string> GetProcessPathCandidates(string? pathValue)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
            return Array.Empty<string>();
        return pathValue
            .Split(_pathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(Unquote)
            .Where(IsAbsolutePath)
            .Select(directory => Join(directory, _executableName))
            .ToArray();
    }

    public IReadOnlyList<string> GetStandardPathCandidates() => _standardPaths;

    private string? Candidate(string? root, params string[] parts)
    {
        var value = NonEmpty(root);
        return value is null ? null : Join(new[] { value }.Concat(parts).ToArray());
    }

    private string Join(params string[] parts)
    {
        var result = parts[0].TrimEnd('/', '\\');
        if (result.Length == 2 && result[1] == ':')
            result += _directorySeparator;
        foreach (var part in parts.Skip(1))
        {
            if (!result.EndsWith(_directorySeparator))
                result += _directorySeparator;
            result += part.Trim('/', '\\');
        }
        return result;
    }

    private bool IsDirectorySeparator(char value) => value is '/' or '\\';

    private static string Unquote(string value) =>
        value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1] : value;

    private static string? NonEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
