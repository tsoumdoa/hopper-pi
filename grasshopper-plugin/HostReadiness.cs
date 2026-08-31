using System;
using System.Text.Json;

namespace rhino_zmq_poc
{
    public static class HostReadiness
    {
        public static bool TryParse(string line, int expectedPid, out Uri url)
        {
            url = null;
            if (string.IsNullOrWhiteSpace(line))
                return false;

            try
            {
                using var json = JsonDocument.Parse(line);
                var root = json.RootElement;
                if (!root.TryGetProperty("type", out var type) || type.GetString() != "ready")
                    return false;
                if (!root.TryGetProperty("url", out var rawUrl) ||
                    !Uri.TryCreate(rawUrl.GetString(), UriKind.Absolute, out var parsed))
                    return false;
                if (parsed.Scheme != Uri.UriSchemeHttp ||
                    !string.Equals(parsed.Host, "127.0.0.1", StringComparison.Ordinal) ||
                    parsed.IsDefaultPort ||
                    !string.IsNullOrEmpty(parsed.UserInfo) ||
                    !string.IsNullOrEmpty(parsed.Query) ||
                    parsed.AbsolutePath != "/" ||
                    !IsValidTokenFragment(parsed.Fragment))
                    return false;
                if (!root.TryGetProperty("pid", out var pid) ||
                    pid.ValueKind != JsonValueKind.Number ||
                    pid.GetInt32() != expectedPid)
                    return false;

                url = parsed;
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsValidTokenFragment(string fragment)
        {
            if (string.IsNullOrEmpty(fragment) || fragment[0] != '#')
                return false;

            var token = fragment.Substring(1);
            if (token.Length < 20 || token.Length > 256)
                return false;

            foreach (var ch in token)
            {
                var alphaNumeric =
                    (ch >= 'a' && ch <= 'z') ||
                    (ch >= 'A' && ch <= 'Z') ||
                    (ch >= '0' && ch <= '9');
                if (!alphaNumeric && ch != '-' && ch != '_')
                    return false;
            }
            return true;
        }
    }
}
