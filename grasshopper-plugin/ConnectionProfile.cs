using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace rhino_zmq_poc
{
    internal class ConnectionProfile
    {
        [JsonPropertyName("protocolVersion")]
        public int ProtocolVersion { get; set; } = 1;

        [JsonPropertyName("instanceId")]
        public string InstanceId { get; set; }

        [JsonPropertyName("pubEndpoint")]
        public string PubEndpoint { get; set; }

        [JsonPropertyName("pushEndpoint")]
        public string PushEndpoint { get; set; }

        [JsonPropertyName("reqEndpoint")]
        public string ReqEndpoint { get; set; }

        [JsonPropertyName("token")]
        public string Token { get; set; }

        [JsonPropertyName("startedAt")]
        public long StartedAt { get; set; }
    }

    internal static class ConnectionProfileStore
    {
        private const string AppDirectoryName = "hopper-pi";
        private const string ProfileFileName = "connection.json";
        private const string TokenFileName = "connection-token";
        private const string InstancesDirectoryName = "instances";

        public static string DirectoryPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            AppDirectoryName);

        public static string ProfilePath => Path.Combine(DirectoryPath, ProfileFileName);

        public static string CreateInstanceProfilePath(string instanceId)
        {
            var safeInstanceId = string.IsNullOrWhiteSpace(instanceId)
                ? Guid.NewGuid().ToString("N")
                : instanceId;
            return Path.Combine(
                DirectoryPath,
                InstancesDirectoryName,
                $"{Process.GetCurrentProcess().Id}-{safeInstanceId}.json");
        }

        private static string TokenPath => Path.Combine(DirectoryPath, TokenFileName);

        public static string LoadOrCreateToken()
        {
            Directory.CreateDirectory(DirectoryPath);

            if (File.Exists(TokenPath))
            {
                var existing = File.ReadAllText(TokenPath).Trim();
                if (!string.IsNullOrEmpty(existing))
                    return existing;
            }

            var token = GenerateToken();
            WriteAllTextAtomic(TokenPath, token + Environment.NewLine);
            return token;
        }

        public static void Write(ConnectionProfile profile, string instanceProfilePath)
        {
            Directory.CreateDirectory(DirectoryPath);
            var json = JsonSerializer.Serialize(profile, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            if (!string.IsNullOrWhiteSpace(instanceProfilePath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(instanceProfilePath));
                WriteAllTextAtomic(instanceProfilePath, json + Environment.NewLine);
            }
            try
            {
                // Compatibility pointer for standalone clients. The spawned host uses
                // the instance-specific path above, so a second Rhino process racing
                // this write must not prevent this backend from starting.
                WriteAllTextAtomic(ProfilePath, json + Environment.NewLine);
            }
            catch
            {
            }
        }

        public static void DeleteIfOwned(string instanceId, string instanceProfilePath)
        {
            if (string.IsNullOrEmpty(instanceId))
                return;

            DeleteOneIfOwned(instanceProfilePath, instanceId);
            DeleteOneIfOwned(ProfilePath, instanceId);
        }

        private static void DeleteOneIfOwned(string path, string instanceId)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                return;
            try
            {
                var json = File.ReadAllText(path);
                var profile = JsonSerializer.Deserialize<ConnectionProfile>(json);
                if (profile?.InstanceId == instanceId)
                    File.Delete(path);
            }
            catch
            {
                // Stale or unreadable profiles are harmless; the frontend will probe before use.
            }
        }

        private static string GenerateToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            return Convert.ToBase64String(bytes)
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }

        private static void WriteAllTextAtomic(string path, string contents)
        {
            var tempPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(tempPath, contents);

            File.Move(tempPath, path, true);
            RestrictFilePermissions(path);
        }

        private static void RestrictFilePermissions(string path)
        {
            if (!File.Exists(path) || OperatingSystem.IsWindows())
                return;

            try
            {
                // 0600 = owner read/write only. P/Invoke avoids the net7.0-windows
                // compiler error from File.SetUnixPermissionMode (Unix-only BCL symbol).
                chmod(path, 0b_110_000_000);
            }
            catch
            {
                // Best effort — hardening is defense-in-depth, not a hard gate.
            }
        }

        [DllImport("libc", SetLastError = true)]
        private static extern int chmod(string path, int mode);
    }
}
