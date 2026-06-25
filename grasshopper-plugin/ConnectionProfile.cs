using System;
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

        public static string DirectoryPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            AppDirectoryName);

        public static string ProfilePath => Path.Combine(DirectoryPath, ProfileFileName);

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

        public static void Write(ConnectionProfile profile)
        {
            Directory.CreateDirectory(DirectoryPath);
            var json = JsonSerializer.Serialize(profile, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            WriteAllTextAtomic(ProfilePath, json + Environment.NewLine);
        }

        public static void DeleteIfOwned(string instanceId)
        {
            if (string.IsNullOrEmpty(instanceId) || !File.Exists(ProfilePath))
                return;

            try
            {
                var json = File.ReadAllText(ProfilePath);
                var profile = JsonSerializer.Deserialize<ConnectionProfile>(json);
                if (profile?.InstanceId == instanceId)
                    File.Delete(ProfilePath);
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

            if (File.Exists(path))
                File.Delete(path);

            File.Move(tempPath, path);
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
