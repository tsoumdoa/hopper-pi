using System.Text.Json;

namespace Hopper.Core;

public sealed record InstanceProfileEndpoints(string RpcEndpoint, string PubEndpoint);

public sealed record InstanceProfileAuthentication(string Token);

public sealed record InstanceConnectionProfile(
    int ProtocolVersion,
    int OwnerProcessId,
    DateTimeOffset OwnerProcessStartedAt,
    string LifecycleInstanceId,
    DateTimeOffset CreatedAt,
    InstanceProfileEndpoints Endpoints,
    InstanceProfileAuthentication Authentication);

public static class InstanceProfileCodec
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static string Serialize(InstanceConnectionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        Validate(profile);
        return JsonSerializer.Serialize(profile, JsonOptions);
    }

    public static bool TryDeserialize(string json, out InstanceConnectionProfile? profile)
    {
        profile = null;
        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            var candidate = JsonSerializer.Deserialize<InstanceConnectionProfile>(json, JsonOptions);
            if (candidate is null)
            {
                return false;
            }

            Validate(candidate);
            profile = candidate;
            return true;
        }
        catch (Exception exception) when (exception is JsonException or ArgumentException)
        {
            return false;
        }
    }

    private static void Validate(InstanceConnectionProfile profile)
    {
        if (profile.ProtocolVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(profile), "The protocol version must be positive.");
        }

        if (profile.OwnerProcessId < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(profile), "The owner process ID must be positive.");
        }

        if (profile.OwnerProcessStartedAt == default)
        {
            throw new ArgumentException("The owner process start time is required.", nameof(profile));
        }

        if (string.IsNullOrWhiteSpace(profile.LifecycleInstanceId))
        {
            throw new ArgumentException("The lifecycle instance ID is required.", nameof(profile));
        }

        if (profile.CreatedAt == default)
        {
            throw new ArgumentException("The creation time is required.", nameof(profile));
        }

        if (profile.Endpoints is null ||
            string.IsNullOrWhiteSpace(profile.Endpoints.RpcEndpoint) ||
            string.IsNullOrWhiteSpace(profile.Endpoints.PubEndpoint))
        {
            throw new ArgumentException("Both instance endpoints are required.", nameof(profile));
        }

        if (profile.Authentication is null || string.IsNullOrWhiteSpace(profile.Authentication.Token))
        {
            throw new ArgumentException("Instance authentication data is required.", nameof(profile));
        }
    }
}

public interface IInstanceProfileFileSystem
{
    bool FileExists(string path);
    bool DirectoryExists(string path);
    IEnumerable<string> EnumerateFiles(string path, string searchPattern);
    string ReadAllText(string path);
    void CreateDirectory(string path);
    void WriteAllText(string path, string contents);
    void MoveReplace(string sourcePath, string destinationPath);
    void DeleteFile(string path);
    void DeleteDirectory(string path, bool recursive);
}

public sealed class SystemInstanceProfileFileSystem : IInstanceProfileFileSystem
{
    public bool FileExists(string path) => File.Exists(path);
    public bool DirectoryExists(string path) => Directory.Exists(path);
    public IEnumerable<string> EnumerateFiles(string path, string searchPattern) =>
        Directory.EnumerateFiles(path, searchPattern, SearchOption.TopDirectoryOnly);
    public string ReadAllText(string path) => File.ReadAllText(path);
    public void CreateDirectory(string path) => Directory.CreateDirectory(path);
    public void WriteAllText(string path, string contents) => File.WriteAllText(path, contents);
    public void MoveReplace(string sourcePath, string destinationPath) =>
        File.Move(sourcePath, destinationPath, overwrite: true);
    public void DeleteFile(string path) => File.Delete(path);
    public void DeleteDirectory(string path, bool recursive) => Directory.Delete(path, recursive);
}

public interface IAtomicWritePathProvider
{
    string CreateTemporarySiblingPath(string destinationPath);
}

public sealed class UniqueAtomicWritePathProvider : IAtomicWritePathProvider
{
    public string CreateTemporarySiblingPath(string destinationPath) =>
        $"{destinationPath}.{Guid.NewGuid():N}.tmp";
}

public sealed record InstanceProfileWriteResult(
    bool CompatibilityPointerWritten,
    string? CompatibilityPointerError);

public sealed class InstanceProfileStore
{
    private readonly IInstanceProfileFileSystem _fileSystem;
    private readonly IAtomicWritePathProvider _temporaryPaths;

    public InstanceProfileStore(
        IInstanceProfileFileSystem fileSystem,
        IAtomicWritePathProvider temporaryPaths)
    {
        _fileSystem = fileSystem;
        _temporaryPaths = temporaryPaths;
    }

    public InstanceProfileWriteResult Write(
        InstanceConnectionProfile profile,
        string authoritativeProfilePath,
        string compatibilityPointerPath)
    {
        if (string.IsNullOrWhiteSpace(authoritativeProfilePath))
        {
            throw new ArgumentException("An authoritative profile path is required.", nameof(authoritativeProfilePath));
        }

        if (string.IsNullOrWhiteSpace(compatibilityPointerPath))
        {
            throw new ArgumentException("A compatibility pointer path is required.", nameof(compatibilityPointerPath));
        }

        var json = InstanceProfileCodec.Serialize(profile);
        AtomicWrite(authoritativeProfilePath, json);

        try
        {
            // This is intentionally last-writer-wins. Managed hosts must use the
            // instance-specific authoritative profile, never this compatibility pointer.
            AtomicWrite(compatibilityPointerPath, json);
            return new InstanceProfileWriteResult(true, null);
        }
        catch (Exception exception)
        {
            return new InstanceProfileWriteResult(false, exception.Message);
        }
    }

    internal void AtomicWrite(string destinationPath, string contents)
    {
        var directory = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrEmpty(directory))
        {
            _fileSystem.CreateDirectory(directory);
        }

        var temporaryPath = _temporaryPaths.CreateTemporarySiblingPath(destinationPath);
        try
        {
            _fileSystem.WriteAllText(temporaryPath, contents);
            _fileSystem.MoveReplace(temporaryPath, destinationPath);
        }
        catch
        {
            try
            {
                if (_fileSystem.FileExists(temporaryPath))
                {
                    _fileSystem.DeleteFile(temporaryPath);
                }
            }
            catch
            {
                // Preserve the original write failure. An orphaned uniquely-named
                // temporary file is safer than replacing a valid profile non-atomically.
            }

            throw;
        }
    }
}

public interface IInstanceProfileClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemInstanceProfileClock : IInstanceProfileClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public sealed class SystemProcessIdentityInspector : IProcessIdentityInspector
{
    public ProcessIdentityObservation Inspect(int processId)
    {
        if (processId < 1)
            throw new ArgumentOutOfRangeException(nameof(processId));

        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(processId);
            if (process.HasExited)
                return new ProcessIdentityObservation(ProcessInspectionState.NotRunning);
            return new ProcessIdentityObservation(
                ProcessInspectionState.Running,
                process.StartTime.ToUniversalTime());
        }
        catch (ArgumentException)
        {
            return new ProcessIdentityObservation(ProcessInspectionState.NotRunning);
        }
        catch
        {
            return new ProcessIdentityObservation(ProcessInspectionState.Uninspectable);
        }
    }
}

public enum ProcessInspectionState
{
    Running,
    NotRunning,
    Uninspectable
}

public sealed record ProcessIdentityObservation(
    ProcessInspectionState State,
    DateTimeOffset? StartedAt = null);

public interface IProcessIdentityInspector
{
    ProcessIdentityObservation Inspect(int processId);
}

public sealed record InstanceProfilePaths(
    string AuthoritativeProfilePath,
    string EphemeralLogsDirectoryPath,
    string VerifiedDeadMarkerPath);

public enum InstanceProfileOwnershipState
{
    NoProfile,
    Active,
    VerifiedDead,
    Malformed,
    Uninspectable,
    Replaced
}

public sealed record InstanceProfileCleanupResult(
    InstanceProfileOwnershipState OwnershipState,
    bool ProfileDeleted,
    bool LogsDeleted,
    bool VerifiedDeadMarkerWritten,
    string? Error);

public sealed record InstanceProfileScanEntry(
    string LifecycleInstanceId,
    InstanceProfileCleanupResult Cleanup);

public sealed record InstanceProfileScanReport(
    IReadOnlyList<InstanceProfileScanEntry> Entries,
    string? Error);

/// <summary>
/// Scans only the production profile directory. File names are reduced to validated
/// lifecycle IDs and recomposed below that directory before the retention policy runs.
/// </summary>
public sealed class InstanceProfileDirectoryScanner
{
    public const string ProfileSuffix = ".json";
    public const string VerifiedDeadMarkerSuffix = ".verified-dead.json";
    public const string EphemeralLogsSuffix = ".logs";

    private readonly IInstanceProfileFileSystem _fileSystem;
    private readonly InstanceProfileRetentionPolicy _policy;

    public InstanceProfileDirectoryScanner(
        IInstanceProfileFileSystem fileSystem,
        IProcessIdentityInspector processes,
        IInstanceProfileClock clock,
        IAtomicWritePathProvider temporaryPaths)
    {
        _fileSystem = fileSystem ?? throw new ArgumentNullException(nameof(fileSystem));
        _policy = new InstanceProfileRetentionPolicy(fileSystem, processes, clock, temporaryPaths);
    }

    public InstanceProfileScanReport Scan(string profilesDirectory)
    {
        if (string.IsNullOrWhiteSpace(profilesDirectory))
            throw new ArgumentException("A profiles directory is required.", nameof(profilesDirectory));
        if (!_fileSystem.DirectoryExists(profilesDirectory))
            return new InstanceProfileScanReport(Array.Empty<InstanceProfileScanEntry>(), null);

        string[] candidates;
        try
        {
            candidates = _fileSystem.EnumerateFiles(profilesDirectory, $"*{ProfileSuffix}")
                .ToArray();
        }
        catch (Exception exception)
        {
            return new InstanceProfileScanReport(
                Array.Empty<InstanceProfileScanEntry>(),
                exception.Message);
        }

        var lifecycleIds = candidates
            .Select(TryGetLifecycleId)
            .Where(identifier => identifier != null)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(identifier => identifier, StringComparer.Ordinal)
            .ToArray();
        var results = new List<InstanceProfileScanEntry>(lifecycleIds.Length);
        foreach (var lifecycleId in lifecycleIds)
        {
            try
            {
                results.Add(new InstanceProfileScanEntry(
                    lifecycleId!,
                    _policy.Cleanup(Paths(profilesDirectory, lifecycleId!))));
            }
            catch (Exception exception)
            {
                results.Add(new InstanceProfileScanEntry(
                    lifecycleId!,
                    new InstanceProfileCleanupResult(
                        InstanceProfileOwnershipState.Uninspectable,
                        false,
                        false,
                        false,
                        exception.Message)));
            }
        }

        return new InstanceProfileScanReport(results, null);
    }

    public static InstanceProfilePaths Paths(string profilesDirectory, string lifecycleInstanceId)
    {
        RequireLifecycleId(lifecycleInstanceId);
        return new InstanceProfilePaths(
            Path.Combine(profilesDirectory, lifecycleInstanceId + ProfileSuffix),
            Path.Combine(profilesDirectory, lifecycleInstanceId + EphemeralLogsSuffix),
            Path.Combine(profilesDirectory, lifecycleInstanceId + VerifiedDeadMarkerSuffix));
    }

    private static string? TryGetLifecycleId(string path)
    {
        var fileName = Path.GetFileName(path);
        var lifecycleId = fileName.EndsWith(VerifiedDeadMarkerSuffix, StringComparison.Ordinal)
            ? fileName[..^VerifiedDeadMarkerSuffix.Length]
            : fileName.EndsWith(ProfileSuffix, StringComparison.Ordinal)
                ? fileName[..^ProfileSuffix.Length]
                : null;
        return IsLifecycleId(lifecycleId) ? lifecycleId : null;
    }

    private static void RequireLifecycleId(string lifecycleInstanceId)
    {
        if (!IsLifecycleId(lifecycleInstanceId))
            throw new ArgumentException("Lifecycle instance ID is invalid.", nameof(lifecycleInstanceId));
    }

    private static bool IsLifecycleId(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length <= 128
        && value.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');
}

public sealed class InstanceProfileRetentionPolicy
{
    public static readonly TimeSpan EphemeralLogRetention = TimeSpan.FromDays(7);

    private readonly IInstanceProfileFileSystem _fileSystem;
    private readonly IProcessIdentityInspector _processes;
    private readonly IInstanceProfileClock _clock;
    private readonly InstanceProfileStore _store;

    public InstanceProfileRetentionPolicy(
        IInstanceProfileFileSystem fileSystem,
        IProcessIdentityInspector processes,
        IInstanceProfileClock clock,
        IAtomicWritePathProvider temporaryPaths)
    {
        _fileSystem = fileSystem;
        _processes = processes;
        _clock = clock;
        _store = new InstanceProfileStore(fileSystem, temporaryPaths);
    }

    public InstanceProfileCleanupResult Cleanup(InstanceProfilePaths paths)
    {
        ArgumentNullException.ThrowIfNull(paths);

        if (TryReadMarker(paths.VerifiedDeadMarkerPath, out var marker))
        {
            return CleanupVerifiedDead(paths, marker!, markerWasJustWritten: false);
        }

        if (!_fileSystem.FileExists(paths.AuthoritativeProfilePath))
        {
            var state = _fileSystem.FileExists(paths.VerifiedDeadMarkerPath)
                ? InstanceProfileOwnershipState.Malformed
                : InstanceProfileOwnershipState.NoProfile;
            return new InstanceProfileCleanupResult(state, false, false, false, null);
        }

        InstanceConnectionProfile? profile;
        try
        {
            if (!InstanceProfileCodec.TryDeserialize(
                    _fileSystem.ReadAllText(paths.AuthoritativeProfilePath), out profile))
            {
                return new InstanceProfileCleanupResult(
                    InstanceProfileOwnershipState.Malformed, false, false, false, null);
            }
        }
        catch (Exception exception)
        {
            return new InstanceProfileCleanupResult(
                InstanceProfileOwnershipState.Uninspectable, false, false, false, exception.Message);
        }

        ProcessIdentityObservation process;
        try
        {
            process = _processes.Inspect(profile!.OwnerProcessId);
        }
        catch (Exception exception)
        {
            return new InstanceProfileCleanupResult(
                InstanceProfileOwnershipState.Uninspectable, false, false, false, exception.Message);
        }

        if (process.State == ProcessInspectionState.Running &&
            process.StartedAt is { } actualStartedAt &&
            actualStartedAt.Equals(profile!.OwnerProcessStartedAt))
        {
            return new InstanceProfileCleanupResult(
                InstanceProfileOwnershipState.Active, false, false, false, null);
        }

        if (process.State == ProcessInspectionState.Uninspectable ||
            (process.State == ProcessInspectionState.Running && process.StartedAt is null))
        {
            return new InstanceProfileCleanupResult(
                InstanceProfileOwnershipState.Uninspectable, false, false, false, null);
        }

        var newMarker = new VerifiedDeadMarker(
            profile!.OwnerProcessId,
            profile.OwnerProcessStartedAt,
            profile.LifecycleInstanceId,
            _clock.UtcNow);

        try
        {
            _store.AtomicWrite(
                paths.VerifiedDeadMarkerPath,
                JsonSerializer.Serialize(newMarker, MarkerJsonOptions));
        }
        catch (Exception exception)
        {
            // Do not delete the profile if doing so would lose the proof needed
            // for the later log-retention decision.
            return new InstanceProfileCleanupResult(
                InstanceProfileOwnershipState.VerifiedDead, false, false, false, exception.Message);
        }

        return CleanupVerifiedDead(paths, newMarker, markerWasJustWritten: true);
    }

    private InstanceProfileCleanupResult CleanupVerifiedDead(
        InstanceProfilePaths paths,
        VerifiedDeadMarker marker,
        bool markerWasJustWritten)
    {
        var profileDeleted = false;
        if (_fileSystem.FileExists(paths.AuthoritativeProfilePath))
        {
            InstanceConnectionProfile? currentProfile;
            try
            {
                if (!InstanceProfileCodec.TryDeserialize(
                        _fileSystem.ReadAllText(paths.AuthoritativeProfilePath), out currentProfile))
                {
                    return new InstanceProfileCleanupResult(
                        InstanceProfileOwnershipState.Malformed,
                        false,
                        false,
                        markerWasJustWritten,
                        null);
                }
            }
            catch (Exception exception)
            {
                return new InstanceProfileCleanupResult(
                    InstanceProfileOwnershipState.Uninspectable,
                    false,
                    false,
                    markerWasJustWritten,
                    exception.Message);
            }

            if (!marker.Matches(currentProfile!))
            {
                return new InstanceProfileCleanupResult(
                    InstanceProfileOwnershipState.Replaced,
                    false,
                    false,
                    markerWasJustWritten,
                    null);
            }

            try
            {
                _fileSystem.DeleteFile(paths.AuthoritativeProfilePath);
                profileDeleted = true;
            }
            catch (Exception exception)
            {
                return new InstanceProfileCleanupResult(
                    InstanceProfileOwnershipState.VerifiedDead,
                    false,
                    false,
                    markerWasJustWritten,
                    exception.Message);
            }
        }

        var logsDeleted = false;
        if (_clock.UtcNow - marker.VerifiedDeadAt >= EphemeralLogRetention)
        {
            try
            {
                if (_fileSystem.DirectoryExists(paths.EphemeralLogsDirectoryPath))
                {
                    _fileSystem.DeleteDirectory(paths.EphemeralLogsDirectoryPath, recursive: true);
                    logsDeleted = true;
                }

                _fileSystem.DeleteFile(paths.VerifiedDeadMarkerPath);
            }
            catch (Exception exception)
            {
                return new InstanceProfileCleanupResult(
                    InstanceProfileOwnershipState.VerifiedDead,
                    profileDeleted,
                    logsDeleted,
                    markerWasJustWritten,
                    exception.Message);
            }
        }

        return new InstanceProfileCleanupResult(
            InstanceProfileOwnershipState.VerifiedDead,
            profileDeleted,
            logsDeleted,
            markerWasJustWritten,
            null);
    }

    private bool TryReadMarker(string path, out VerifiedDeadMarker? marker)
    {
        marker = null;
        if (!_fileSystem.FileExists(path))
        {
            return false;
        }

        try
        {
            var candidate = JsonSerializer.Deserialize<VerifiedDeadMarker>(
                _fileSystem.ReadAllText(path), MarkerJsonOptions);
            if (candidate is null ||
                candidate.OwnerProcessId < 1 ||
                candidate.OwnerProcessStartedAt == default ||
                string.IsNullOrWhiteSpace(candidate.LifecycleInstanceId) ||
                candidate.VerifiedDeadAt == default)
            {
                return false;
            }

            marker = candidate;
            return true;
        }
        catch (Exception exception) when (exception is JsonException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static readonly JsonSerializerOptions MarkerJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private sealed record VerifiedDeadMarker(
        int OwnerProcessId,
        DateTimeOffset OwnerProcessStartedAt,
        string LifecycleInstanceId,
        DateTimeOffset VerifiedDeadAt)
    {
        public bool Matches(InstanceConnectionProfile profile) =>
            OwnerProcessId == profile.OwnerProcessId &&
            OwnerProcessStartedAt.Equals(profile.OwnerProcessStartedAt) &&
            string.Equals(LifecycleInstanceId, profile.LifecycleInstanceId, StringComparison.Ordinal);
    }
}
