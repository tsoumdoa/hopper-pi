import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "vitest";
import { handleBatch } from "./batch.js";
import type { CliDependencies } from "./handlers.js";
import { createOperationRegistry } from "../operations/index.js";
import { SessionStore } from "../session/store.js";
import { CheckpointStore } from "../session/checkpoints.js";
import type { CliIO } from "./io.js";

function memoryIO(): CliIO {
	return {
		stdin: Readable.from("{}"),
		stdout: new Writable({ write(_c, _e, cb) { cb(); } }),
		stderr: new Writable({ write(_c, _e, cb) { cb(); } }),
		env: {},
		cwd: tmpdir(),
	};
}

test("batch rejects reads and non-batchable operations", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-batch-"));
	const deps = {
		registry: createOperationRegistry(),
		connection: () => ({
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/none.json",
		}),
		stateRoot: root,
		sessions: new SessionStore(root),
		checkpoints: new CheckpointStore(root),
		io: memoryIO(),
		now: () => new Date(),
	} as CliDependencies;

	const reads = await handleBatch({
		kind: "batch",
		sessionId: "hs_01JX",
		input: { kind: "inline", json: JSON.stringify({ items: [{ operation: "gh_get_canvas", input: {} }] }) },
		json: true,
	}, deps);
	assert.equal(reads.error?.code, "operation_not_batchable");

	const rhino = await handleBatch({
		kind: "batch",
		sessionId: "hs_01JX",
		input: { kind: "inline", json: JSON.stringify({
			items: [{ operation: "rh_run_script", input: { items: [{ mode: "command", source: "SelAll" }] } }],
		}) },
		json: true,
	}, deps);
	assert.equal(rhino.error?.code, "operation_not_batchable");
});
