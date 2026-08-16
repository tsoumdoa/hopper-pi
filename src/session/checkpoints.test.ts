import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { CheckpointStore, decodeCheckpointBytes } from "./checkpoints.js";
import { HopperCoreError } from "../core/errors.js";
import type { CanvasCheckpointEnvelope } from "../protocol/wire.js";

function envelope(bytes = Buffer.from("gh-binary")): CanvasCheckpointEnvelope {
	return {
		schemaVersion: 1,
		checkpointId: "cp_test1",
		backendId: "be_1",
		grasshopperDocumentId: "ghd_1",
		capturedAt: "2026-08-16T00:00:00.000Z",
		encoding: "base64",
		compression: "none",
		bytes: bytes.toString("base64"),
		byteLength: bytes.byteLength,
		binarySha256: createHash("sha256").update(bytes).digest("hex"),
		canvasDigest: "abc",
		canonicalCanvas: { objects: [], wires: [], groups: [] },
	};
}

test("checkpoint store round-trips and verifies integrity", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-cp-"));
	const store = new CheckpointStore(root);
	const saved = await store.save("hs_01TEST", envelope());
	await store.verify("hs_01TEST", saved.checkpointId);
	const read = await store.read("hs_01TEST", saved.checkpointId);
	assert.equal(read.record.canvasDigest, "abc");
	assert.equal(read.envelope.compression, "gzip");
});

test("corrupt stored bytes fail verification", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-cp-"));
	const store = new CheckpointStore(root);
	const bad = envelope();
	bad.binarySha256 = "0".repeat(64);
	await assert.rejects(() => store.save("hs_01TEST", bad), HopperCoreError);
});

test("decodeCheckpointBytes rejects a digest mismatch", () => {
	const payload = envelope();
	payload.binarySha256 = "ff".repeat(32);
	assert.throws(() => decodeCheckpointBytes(payload), HopperCoreError);
});
