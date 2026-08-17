import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "vitest";
import { Type } from "@sinclair/typebox";
import { handleBatch } from "./batch.js";
import type { CliDependencies } from "./handlers.js";
import { createOperationRegistry } from "../operations/index.js";
import { defineOperation, OperationRegistry } from "../core/operations.js";
import { SessionStore } from "../session/store.js";
import { CheckpointStore } from "../session/checkpoints.js";
import type { CliIO } from "./io.js";
import type { BackendClient } from "../protocol/backend-client.js";
import type { JsonObject, JsonValue } from "../core/contracts.js";

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

test("batch prepares with the bound backend and slices action results", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-batch-bound-"));
	const sessions = new SessionStore(root);
	const backend = {
		backendId: "be_test" as const,
		backendStartedAt: "2026-08-17T00:00:00.000Z",
		pluginVersion: "1.0.0",
		protocolVersion: 1 as const,
	};
	const documents = {
		grasshopper: { documentId: "ghd_test" as const, displayName: "test.gh", path: null },
		rhino: null,
	};
	const session = await sessions.create({ captureAllowed: false }, backend, documents);
	const queryBodies: JsonObject[] = [];
	const client = batchClient(backend, documents, queryBodies);
	const registry = new OperationRegistry();
	for (const name of ["first", "second"] as const) {
		registry.register(defineOperation({
			name,
			version: 1,
			description: name,
			group: "gh-edit",
			possibleScopes: ["grasshopper"],
			inputSchema: Type.Object({ label: Type.String() }),
			outputSchema: Type.Object({ message: Type.String() }),
			classifyScope: () => "grasshopper",
			summarizeInput: (input) => input,
			async prepareMutation(input, context) {
				assert.equal(context.session?.sessionId, session.sessionId);
				await context.backend.query({ type: "getScriptCode", targetId: input.label }, context.signal);
				return {
					scope: "grasshopper",
					actions: [{ kind: "command", command: { action: "moveComponent" }, label: input.label }],
					finish(response) {
						const data = response.data as { actions?: Array<{ message?: string }> } | null;
						return {
							outcome: response.outcome,
							message: data?.actions?.[0]?.message ?? "missing",
							data: { message: data?.actions?.[0]?.message ?? "missing" },
							warnings: [],
							artifacts: [],
							error: response.error,
						};
					},
				};
			},
			async execute() {
				throw new Error("batch should use prepareMutation");
			},
		}));
	}

	const deps = {
		registry,
		connection: () => ({
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/none.json",
		}),
		createProtocolClient: () => client,
		stateRoot: root,
		sessions,
		checkpoints: new CheckpointStore(root),
		io: memoryIO(),
		now: () => new Date("2026-08-17T00:00:00.000Z"),
	} as CliDependencies;

	const response = await handleBatch({
		kind: "batch",
		sessionId: session.sessionId,
		input: { kind: "inline", json: JSON.stringify({ items: [
			{ operation: "first", input: { label: "a" } },
			{ operation: "second", input: { label: "b" } },
		] }) },
		json: true,
	}, deps);

	assert.equal(response.ok, true, response.message);
	const resultItems = (response.data as { items: Array<{ data: { message: string } }> }).items;
	assert.deepEqual(resultItems.map((item) => item.data.message), ["result-a", "result-b"]);
	assert.equal(queryBodies.length, 2);
	assert.ok(queryBodies.every((body) => body.expectedBackendId === "be_test"));
	assert.ok(queryBodies.every((body) => body.expectedGrasshopperDocumentId === "ghd_test"));
});

function batchClient(
	backend: { backendId: "be_test"; backendStartedAt: string; pluginVersion: string; protocolVersion: 1 },
	documents: { grasshopper: { documentId: "ghd_test"; displayName: string; path: null }; rhino: null },
	queryBodies: JsonObject[],
): BackendClient {
	const envelope = <T extends JsonValue>(type: string, requestId: string, data: T) => ({
		protocolVersion: 1 as const,
		type,
		requestId: requestId as `req_${string}`,
		backend,
		documents,
		outcome: "succeeded" as const,
		startedAt: null,
		completedAt: null,
		data,
		error: null,
	});
	return {
		async getInfo() {
			return envelope("getBackendInfo", "req_info", {
				capabilities: ["query", "executeActions"],
				maxRequestBytes: 1,
				maxCheckpointBytes: 1,
				deduplicationWindowMs: 1,
			});
		},
		async query<T extends JsonValue>(request: { requestId: `req_${string}`; body: JsonObject }) {
			queryBodies.push(request.body);
			return envelope("query", request.requestId, { code: "old code" }) as never as Promise<T>;
		},
		async executeActions(request) {
			return envelope("executeActions", request.requestId, {
				payloadSha256: request.payloadSha256,
				actions: ["a", "b"].map((label, index) => ({
					index,
					kind: "command" as const,
					action: "moveComponent" as const,
					outcome: "succeeded" as const,
					message: `result-${label}`,
					data: null,
					error: null,
					elapsedMs: 1,
				})),
				transaction: {
					outcome: "committed" as const,
					grasshopperUndoRecorded: true,
					rhinoUndoRecorded: false,
					grasshopperRolledBack: false,
					rhinoRolledBack: false,
					limitations: [],
				},
				canvasDigestBefore: "before",
				canvasDigestAfter: "after",
				elapsedMs: 2,
			});
		},
		async captureCheckpoint(request) {
			const checkpointBytes = Buffer.from("checkpoint");
			return envelope("captureCheckpoint", request.requestId, {
				schemaVersion: 1 as const,
				checkpointId: "cp_test",
				backendId: backend.backendId,
				grasshopperDocumentId: documents.grasshopper.documentId,
				capturedAt: "2026-08-17T00:00:00.000Z",
				encoding: "base64" as const,
				compression: "none" as const,
				bytes: checkpointBytes.toString("base64"),
				byteLength: checkpointBytes.byteLength,
				binarySha256: createHash("sha256").update(checkpointBytes).digest("hex"),
				canvasDigest: "digest",
				canonicalCanvas: { objects: [], wires: [], groups: [] },
			});
		},
		async getRequestStatus() { throw new Error("unexpected status"); },
		async restoreCheckpoint() { throw new Error("unexpected restore"); },
		async close() {},
	} as BackendClient;
}
