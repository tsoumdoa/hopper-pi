using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using rhino_zmq_poc;
using rhino_zmq_poc.Protocol;

namespace grasshopper_plugin.Tests
{
    public sealed class BackendRequestRouterTests
    {
        private sealed class RecordingHandler : IBackendRequestHandler
        {
            public int Calls;
            public Func<JsonElement, WireResponseDto<JsonElement>> OnHandle { get; set; } =
                _ => BackendRequestRouter.Success("succeeded", new { ok = true });

            public Task<WireResponseDto<JsonElement>> HandleAsync(RequestContext context, JsonElement body)
            {
                Interlocked.Increment(ref Calls);
                return Task.FromResult(OnHandle(body));
            }
        }

        private static BackendRequestRouter BuildRouter(
            out RecordingHandler handler,
            Func<string, bool> authorize = null)
        {
            var backend = new BackendIdentityDto
            {
                BackendId = "be_test",
                PluginVersion = "test",
            };
            var router = new BackendRequestRouter(
                authorize ?? (_ => true),
                () => backend,
                () => null);
            handler = new RecordingHandler();
            router.Register("getBackendInfo", handler);
            return router;
        }

        private static string Envelope(
            string type,
            string body,
            string requestId = "req_01M0000000000000000000000",
            int protocolVersion = 1,
            string token = "secret") => JsonSerializer.Serialize(new
        {
            protocolVersion,
            type,
            requestId,
            issuedAt = "2026-08-15T00:00:00Z",
            body = JsonSerializer.Deserialize<JsonElement>(body),
            token,
        });

        [Fact]
        public async Task Valid_request_reaches_handler_and_gets_envelope()
        {
            var router = BuildRouter(out var handler);
            var response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}"), CancellationToken.None);

            Assert.Equal(1, handler.Calls);
            Assert.Equal("getBackendInfo", response.Type);
            Assert.Equal("req_01M0000000000000000000000", response.RequestId);
            Assert.Equal("be_test", response.Backend.BackendId);
            Assert.Equal("succeeded", response.Outcome);
        }

        [Fact]
        public async Task Wrong_token_is_rejected_without_calling_handlers()
        {
            var router = BuildRouter(out var handler, authorize => authorize == "secret");
            var response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}", token: "wrong"), CancellationToken.None);

            Assert.Equal(0, handler.Calls);
            Assert.Equal("failed", response.Outcome);
            Assert.Equal("authentication_failed", response.Error.Code);
        }

        [Fact]
        public async Task Protocol_version_mismatch_is_rejected()
        {
            var router = BuildRouter(out var handler);
            var response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}", protocolVersion: 2), CancellationToken.None);

            Assert.Equal(0, handler.Calls);
            Assert.Equal("protocol_mismatch", response.Error.Code);
        }

        [Fact]
        public async Task Unknown_request_type_is_invalid_command()
        {
            var router = BuildRouter(out var handler);
            var response = await router.DispatchAsync(
                Envelope("nope", "{}"), CancellationToken.None);

            Assert.Equal(0, handler.Calls);
            Assert.Equal("invalid_command", response.Error.Code);
        }

        [Fact]
        public async Task Handler_exceptions_become_structured_operation_failures()
        {
            var router = BuildRouter(out var handler);
            var response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}"), CancellationToken.None);

            handler.OnHandle = _ => throw new InvalidOperationException("boom");
            response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}", requestId: "req_01M0000000000000000000001"),
                CancellationToken.None);
            Assert.Equal("operation_failed", response.Error.Code);

            handler.OnHandle = _ => throw new HopperRequestException("document_conflict", "wrong doc");
            response = await router.DispatchAsync(
                Envelope("getBackendInfo", "{}", requestId: "req_01M0000000000000000000002"),
                CancellationToken.None);
            Assert.Equal("document_conflict", response.Error.Code);
        }

        [Fact]
        public async Task Invalid_json_or_missing_request_id_is_invalid_input()
        {
            var router = BuildRouter(out var handler);

            var bad = await router.DispatchAsync("not json", CancellationToken.None);
            Assert.Equal("invalid_input", bad.Error.Code);

            var noId = await router.DispatchAsync(
                JsonSerializer.Serialize(new { protocolVersion = 1, type = "getBackendInfo", body = new { } }),
                CancellationToken.None);
            Assert.Equal("invalid_input", noId.Error.Code);
        }

        [Fact]
        public void Redacted_logs_never_contain_tokens_or_bodies()
        {
            var redacted = RequestLogRedactor.Redact(
                Envelope("executeActions", JsonSerializer.Serialize(new
                {
                    source = "import rhinoscriptsyntax",
                    expectedBackendId = "be_x",
                })));

            Assert.DoesNotContain("secret", redacted);
            Assert.DoesNotContain("import rhinoscriptsyntax", redacted);
            Assert.Contains("executeActions", redacted);
            Assert.Contains("req_01M0000000000000000000000", redacted);
        }
    }

    public sealed class ExecuteActionsDigestTests
    {
        [Fact]
        public void Digest_validation_rejects_wrong_and_missing_digests()
        {
            var body = JsonSerializer.SerializeToElement(new { action = "moveComponent" });

            Assert.Throws<HopperRequestException>(
                () => ExecuteActionsHandler.ValidatePayloadSha256(null, body));
            Assert.Throws<HopperRequestException>(
                () => ExecuteActionsHandler.ValidatePayloadSha256("deadbeef", body));
        }

        [Fact]
        public void Digest_validation_accepts_canonical_digest()
        {
            var body = JsonSerializer.SerializeToElement(new
            {
                b = 2,
                a = 1,
                nested = new[] { 1, 2, 3 },
            });
            var digest = CanonicalJson.Sha256(body.Clone());

            ExecuteActionsHandler.ValidatePayloadSha256(digest, body.Clone());
        }
    }

    public sealed class DocumentIdentityServiceTests
    {
        [Fact]
        public void Backend_identity_is_stable_for_service_lifetime()
        {
            var first = new DocumentIdentityService("1.0");
            var second = new DocumentIdentityService("1.0", backendId: "be_fixed");

            Assert.StartsWith("be_", first.Backend.BackendId);
            Assert.Equal("be_fixed", second.Backend.BackendId);
            Assert.Equal(1, second.Backend.ProtocolVersion);
            Assert.Equal("1.0", second.Backend.PluginVersion);
        }

        [Fact]
        public void Grasshopper_identity_is_stable_across_renames_of_the_same_document()
        {
            var service = new DocumentIdentityService("1.0");
            var documentKey = new object();

            var original = service.GetGrasshopperIdentity(documentKey, "Untitled", null);
            var renamed = service.GetGrasshopperIdentity(documentKey, "pavilion.gh", "/tmp/pavilion.gh");

            Assert.Equal(original.DocumentId, renamed.DocumentId);
            Assert.Equal("pavilion.gh", renamed.DisplayName);
            Assert.Equal("/tmp/pavilion.gh", renamed.Path);
        }

        [Fact]
        public void Rhino_identity_is_stable_per_runtime_serial_number()
        {
            var service = new DocumentIdentityService("1.0");

            var first = service.GetRhinoIdentity(42, "Doc1", "/tmp/a.3dm");
            var again = service.GetRhinoIdentity(42, "Renamed", "/tmp/b.3dm");
            var other = service.GetRhinoIdentity(43, "Other", null);

            Assert.Equal(first.DocumentId, again.DocumentId);
            Assert.NotEqual(first.DocumentId, other.DocumentId);
        }
    }
}
