import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { SessionStore, SessionStoreError } from "./store.js";
import type { BackendDocuments } from "../protocol/wire.js";
import { journalPath, resolveStateRoot } from "./paths.js";

const BACKEND = {
	backendId: "be_01TESTBACKEND000000000000",
	backendStartedAt: "2026-08-15T00:00:00.000Z",
	pluginVersion: "1.0.0",
	protocolVersion: 1 as const,
};

function documents(rhino: boolean): BackendDocuments {
	return {
		grasshopper: {
			documentId: "ghd_01TESTCANVAS000000000000",
			displayName: "canvas.gh",
			path: "/tmp/canvas.gh",
		},
		rhino: rhino
			? {
				documentId: "rhd_01TESTRHINO0000000000000",
				runtimeSerialNumber: 7,
				displayName: "model.3dm",
				path: "/tmp/model.3dm",
			}
			: null,
	};
}

test("resolveStateRoot honors HOPPER_STATE_DIR", () => {
	const root = resolveStateRoot({ HOPPER_STATE_DIR: "/tmp/hopper-state" });
	assert.match(root, /hopper-state\/hopper$/);
});

test("create persists a bound session and reads it back", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-session-"));
	const store = new SessionStore(root);
	const session = await store.create(
		{ name: "pavilion", captureAllowed: false },
		BACKEND,
		documents(true),
	);
	assert.match(session.sessionId, /^hs_/);
	assert.equal(session.nextEditSequence, 1);

	const read = await store.read(session.sessionId);
	assert.equal(read.binding.backendId, BACKEND.backendId);
	assert.equal(read.binding.rhinoDocumentId, "rhd_01TESTRHINO0000000000000");

	const raw = await readFile(join(root, "sessions", session.sessionId, "session.json"), "utf8");
	assert.equal(JSON.parse(raw).sessionId, session.sessionId);
});

test("read rejects unknown sessions with session_not_found", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-session-"));
	const store = new SessionStore(root);
	await assert.rejects(
		store.read("hs_missing" as `hs_${string}`),
		(error: SessionStoreError) => error.code === "session_not_found",
	);
});

test("close is idempotent and reserves sequential edit IDs", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-session-"));
	const store = new SessionStore(root);
	const session = await store.create({ captureAllowed: false }, BACKEND, documents(false));

	assert.equal(await store.reserveEditId(session.sessionId), "edit_000001");
	assert.equal(await store.reserveEditId(session.sessionId), "edit_000002");

	const closed = await store.close(session.sessionId, "2026-08-15T01:00:00Z");
	assert.equal(closed.closedAt, "2026-08-15T01:00:00Z");
	const again = await store.close(session.sessionId, "2026-08-15T02:00:00Z");
	assert.equal(again.closedAt, "2026-08-15T01:00:00Z");
	await assert.rejects(
		store.reserveEditId(session.sessionId),
		(error: SessionStoreError) => error.code === "session_closed",
	);
});

test("rebind swaps the binding and reports the previous one", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-session-"));
	const store = new SessionStore(root);
	const session = await store.create({ captureAllowed: false }, BACKEND, documents(false));

	const nextBackend = { ...BACKEND, backendId: "be_01NEWBACKEND00000000000000" as const };
	const next = { ...documents(false), grasshopper: { ...documents(false).grasshopper, documentId: "ghd_01NEWCANVAS000000000000" as const } };
	const result = await store.rebind(session.sessionId, nextBackend, next);

	assert.equal(result.previous.backendId, BACKEND.backendId);
	assert.equal(result.session.binding.backendId, "be_01NEWBACKEND00000000000000");
	assert.equal(result.session.binding.grasshopperDocumentId, "ghd_01NEWCANVAS000000000000");
});

test("stored requests round-trip with owner-only permissions", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-session-"));
	const store = new SessionStore(root);
	const session = await store.create({ captureAllowed: false }, BACKEND, documents(false));

	const stored = {
		schemaVersion: 1 as const,
		requestId: "req_01STORED000000000000000000" as const,
		payloadSha256: "a".repeat(64),
		request: {
			protocolVersion: 1,
			type: "executeActions",
			requestId: "req_01STORED000000000000000000",
			issuedAt: "2026-08-15T00:00:00Z",
			body: {},
			payloadSha256: "a".repeat(64),
		} as never,
	};
	await store.writeRequest(session.sessionId, stored);
	const read = await store.readRequest(session.sessionId, stored.requestId);
	assert.equal(read.payloadSha256, stored.payloadSha256);
	await assert.rejects(
		store.readRequest(session.sessionId, "req_01MISSING0000000000000000" as `req_${string}`),
		(error: SessionStoreError) => error.code === "session_not_found",
	);

	if (process.platform !== "win32") {
		const mode = (await stat(join(root, "sessions", session.sessionId, "requests", `${stored.requestId}.json`))).mode & 0o777;
		assert.equal(mode, 0o600);
	}
	void journalPath;
});
