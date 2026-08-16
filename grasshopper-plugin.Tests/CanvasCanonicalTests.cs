using System;
using System.Collections.Generic;
using System.Text.Json;
using Xunit;
using rhino_zmq_poc.Protocol;

namespace grasshopper_plugin.Tests
{
    public sealed class CanvasCanonicalTests
    {
        [Fact]
        public void Digest_is_stable_for_the_same_canonical_canvas()
        {
            var first = SampleCanvas("a");
            var second = SampleCanvas("a");
            Assert.Equal(CanvasCanonical.Digest(first), CanvasCanonical.Digest(second));
        }

        [Fact]
        public void Digest_changes_when_an_object_is_added()
        {
            var before = SampleCanvas("a");
            var after = SampleCanvas("a");
            after.Objects.Add(new CanonicalCanvasObjectDto
            {
                Id = "obj-b",
                TypeId = "type-b",
                Kind = "Panel",
                Name = "Panel",
                X = 40,
                Y = 50,
            });
            Assert.NotEqual(CanvasCanonical.Digest(before), CanvasCanonical.Digest(after));
        }

        [Fact]
        public void DecodeAndValidate_rejects_corrupt_bytes()
        {
            var payload = new byte[] { 1, 2, 3, 4 };
            var envelope = new CanvasCheckpointEnvelopeDto
            {
                SchemaVersion = 1,
                Encoding = "base64",
                Compression = "none",
                Bytes = Convert.ToBase64String(payload),
                ByteLength = payload.Length,
                BinarySha256 = CanvasCanonical.Sha256(payload).Substring(0, 16) + "deadbeefdeadbeef",
            };
            var error = Assert.Throws<HopperRequestException>(
                () => CanvasCanonical.DecodeAndValidate(envelope, 1024));
            Assert.Equal("invalid_input", error.Code);
        }

        [Fact]
        public void DecodeAndValidate_accepts_matching_payload()
        {
            var payload = new byte[] { 9, 8, 7, 6, 5 };
            var envelope = new CanvasCheckpointEnvelopeDto
            {
                SchemaVersion = 1,
                Encoding = "base64",
                Compression = "none",
                Bytes = Convert.ToBase64String(payload),
                ByteLength = payload.Length,
                BinarySha256 = CanvasCanonical.Sha256(payload),
            };
            Assert.Equal(payload, CanvasCanonical.DecodeAndValidate(envelope, 1024));
        }

        [Fact]
        public void DecodeAndValidate_rejects_gzip_payloads()
        {
            var payload = new byte[] { 1 };
            var envelope = new CanvasCheckpointEnvelopeDto
            {
                SchemaVersion = 1,
                Encoding = "base64",
                Compression = "gzip",
                Bytes = Convert.ToBase64String(payload),
                ByteLength = 1,
                BinarySha256 = CanvasCanonical.Sha256(payload),
            };
            var error = Assert.Throws<HopperRequestException>(
                () => CanvasCanonical.DecodeAndValidate(envelope, 1024));
            Assert.Equal("invalid_input", error.Code);
        }

        private static CanonicalCanvasDto SampleCanvas(string suffix) => new CanonicalCanvasDto
        {
            Objects =
            {
                new CanonicalCanvasObjectDto
                {
                    Id = "obj-" + suffix,
                    TypeId = "type-" + suffix,
                    Kind = "NumberSlider",
                    Name = "Slider",
                    X = 10,
                    Y = 20,
                    Properties = new Dictionary<string, JsonElement>(),
                },
            },
            Wires =
            {
                new CanonicalWireDto
                {
                    FromObjectId = "obj-" + suffix,
                    FromPort = "out",
                    ToObjectId = "other",
                    ToPort = "in",
                },
            },
            Groups = { },
        };
    }
}
