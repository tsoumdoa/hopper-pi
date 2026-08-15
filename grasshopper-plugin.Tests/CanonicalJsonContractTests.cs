using System;
using System.IO;
using System.Text.Json;
using Xunit;
using rhino_zmq_poc;
using rhino_zmq_poc.Protocol;

namespace grasshopper_plugin.Tests
{
    public sealed class CanonicalJsonContractTests
    {
        private static readonly string FixtureRoot = FindFixtureRoot();

        private static string FindFixtureRoot()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory != null && directory.Name != "grasshopper-plugin.Tests")
            {
                directory = directory.Parent;
            }
            directory = directory?.Parent; // climb out of the test project into the repo root
            return Path.Combine(directory?.FullName ?? "", "contracts", "protocol", "v1");
        }

        [Fact]
        public void Canonical_vectors_match_TypeScript_digests()
        {
            var fixtures = JsonDocument.Parse(
                File.ReadAllText(Path.Combine(FixtureRoot, "canonical-json-vectors.json"))).RootElement;

            foreach (var vector in fixtures.GetProperty("vectors").EnumerateArray())
            {
                var name = vector.GetProperty("name").GetString();
                var expected = vector.GetProperty("sha256").GetString();
                var actual = CanonicalJson.Sha256(vector.GetProperty("value").Clone());
                Assert.Equal(expected, actual);
            }
        }

        [Fact]
        public void Execute_actions_fixture_digest_matches_canonical_body()
        {
            var fixture = JsonDocument.Parse(
                File.ReadAllText(Path.Combine(FixtureRoot, "execute-actions-request.json"))).RootElement;

            var payloadSha256 = fixture.GetProperty("payloadSha256").GetString();
            var body = fixture.GetProperty("request").GetProperty("body").Clone();

            Assert.Equal(payloadSha256, CanonicalJson.Sha256(body));
        }

        [Fact]
        public void Request_id_fixture_ULIDs_decode_to_their_timestamps()
        {
            var fixtures = JsonDocument.Parse(
                File.ReadAllText(Path.Combine(FixtureRoot, "request-ids.json"))).RootElement;

            foreach (var fixtureCase in fixtures.GetProperty("cases").EnumerateArray())
            {
                var requestId = fixtureCase.GetProperty("expected").GetString();
                var epochMs = fixtureCase.GetProperty("epochMs").GetInt64();

                Assert.True(RequestLedger.TryGetUlidTimestamp(requestId, out var timestamp));
                Assert.Equal(epochMs, timestamp.ToUnixTimeMilliseconds());
            }
        }

        [Fact]
        public void Rejects_malformed_request_ids()
        {
            Assert.False(RequestLedger.TryGetUlidTimestamp("not-a-ulid", out _));
            Assert.False(RequestLedger.TryGetUlidTimestamp("req_", out _));
            Assert.False(RequestLedger.TryGetUlidTimestamp(null, out _));
        }
    }
}
