import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "vitest";
import type { BackendClient } from "../protocol/backend-client.js";
import type {
	GetBackendInfoResponse,
	QueryBackendResponse,
	WireResponse,
} from "../protocol/wire.js";
import type { ConnectionConfig } from "../infra/connection.js";
import type { JsonValue } from "../core/contracts.js";
import { createOperationRegistry } from "../operations/index.js";
import { handleCall, handleCatalog, handleSchema, handleStatus, type CliDependencies } from "./handlers.js";
import { runCli } from "./main.js";
import type { CliIO } from "./io.js";

function memoryIO(stdin: string = "{}"): CliIO & { stdoutText: string } {
	const state = { stdoutText: "" };
	const stdout = new Writable({
		write(chunk, _encoding, callback) {
			state.stdoutText += chunk.toString();
			callback();
		},
	});
	return {
		stdin: Readable.from(stdin),
		stdout,
		stderr: new Writable(),
		env: {},
		cwd: tmpdir(),
		get stdoutText() {
			return state.stdoutText;
		},
	} as CliIO & { stdoutText: string };
}

function infoResponse(documents: WireResponse["documents"] = null): GetBackendInfoResponse {
	return {
		protocolVersion: 1,
		type: "getBackendInfo",
		requestId: "req_01M0000000000000000000000",
		backend: {
			backendId: "be_test",
			backendStartedAt: "2026-08-15T00:00:00.000Z",
			pluginVersion: "1.0.0",
			protocolVersion: 1,
		},
		documents,
		outcome: "succeeded",
		startedAt: null,
		completedAt: null,
		data: {
			capabilities: ["query", "executeActions"],
			maxRequestBytes: 1,
			maxCheckpointBytes: 1,
			deduplicationWindowMs: 1,
		},
		error: null,
	};
}

function fakeProtocolClient(options: {
	info?: GetBackendInfoResponse;
	queryResponse?: (request: { type: string; body: unknown }) => QueryBackendResponse<JsonValue>;
	error?: Error;
}): (connection: ConnectionConfig) => BackendClient {
	const client: BackendClient = {
		async getInfo() {
			if (options.error) throw options.error;
			return options.info ?? infoResponse();
		},
		async query<T extends JsonValue>(request: never) {
			const handler = options.queryResponse;
			if (!handler) throw new Error("unexpected query");
			return handler(request) as never as { then: never } & QueryBackendResponse<T> as never;
		},
		async getRequestStatus() {
			throw new Error("unexpected status");
		},
		async executeActions() {
			throw new Error("unexpected executeActions");
		},
		async captureCheckpoint() {
			const bytes = Buffer.from("checkpoint-bytes");
			return {
				protocolVersion: 1,
				type: "captureCheckpoint",
				requestId: "req_01M0000000000000000000000",
				backend: {
					backendId: "be_test",
					backendStartedAt: "2026-08-15T00:00:00.000Z",
					pluginVersion: "1.0.0",
					protocolVersion: 1,
				},
				documents: null,
				outcome: "succeeded",
				startedAt: null,
				completedAt: null,
				data: {
					schemaVersion: 1,
					checkpointId: "cp_test",
					backendId: "be_test",
					grasshopperDocumentId: "ghd_1",
					capturedAt: "2026-08-15T00:00:00.000Z",
					encoding: "base64",
					compression: "none",
					bytes: bytes.toString("base64"),
					byteLength: bytes.byteLength,
					binarySha256: "00",
					canvasDigest: "digest",
					canonicalCanvas: { objects: [], wires: [], groups: [] },
				},
				error: null,
			} as never;
		},
		async restoreCheckpoint() {
			throw new Error("unexpected restore");
		},
		async close() {},
	};
	return () => client;
}

function deps(io: CliIO, overrides: Partial<CliDependencies> = {}): CliDependencies {
	return {
		registry: createOperationRegistry(),
		connection: () => ({
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/none.json",
		}),
		io,
		now: () => new Date(0),
		...overrides,
	} as CliDependencies;
}

test("status reports backend identity and documents", async () => {
	const io = memoryIO();
	const documents = {
		grasshopper: {
			documentId: "ghd_1" as const,
			displayName: "canvas.gh",
			path: "/tmp/canvas.gh",
		},
		rhino: null,
	};
	const response = await handleStatus({ kind: "status", json: true }, deps(io, {
		createProtocolClient: fakeProtocolClient({ info: infoResponse(documents) }),
	}));
	assert.equal(response.ok, true);
	const data = response.data as { backend?: { backendId?: string } };
	assert.equal(data.backend?.backendId, "be_test");
});

test("status maps offline backends to exit code 3 JSON", async () => {
	const io = memoryIO();
	const response = await handleStatus({ kind: "status", json: true }, deps(io, {
		createProtocolClient: fakeProtocolClient({ error: new Error("nope") }),
	}));
	assert.equal(response.ok, false);
	assert.equal(response.error?.code, "backend_offline");
});

test("catalog lists every registered operation", () => {
	const io = memoryIO();
	const response = handleCatalog({ kind: "catalog", json: true }, deps(io));
	assert.equal(response.ok, true);
	const data = response.data as { operations?: unknown[] };
	assert.equal(data.operations?.length, 16);
});

test("schema returns typed schemas and rejects unknown operations", () => {
	const io = memoryIO();
	const good = handleSchema({ kind: "schema", operation: "gh_apply_graph", json: true }, deps(io));
	assert.equal(good.ok, true);

	const bad = handleSchema({ kind: "schema", operation: "nope", json: true }, deps(io));
	assert.equal(bad.ok, false);
	assert.equal(bad.error?.code, "operation_not_found");
});

test("call executes a read operation end to end", async () => {
	const io = memoryIO('{"selectionOnly":false}');
	const response = await handleCall(
		{
			kind: "call",
			operation: "gh_get_canvas",
			input: { kind: "inline", json: '{"selectionOnly":false}' },
			allowCapture: false,
			json: true,
		},
		deps(io, {
			createProtocolClient: fakeProtocolClient({
				queryResponse: (request) => ({
					protocolVersion: 1,
					type: "query",
					requestId: "req_01M0000000000000000000000",
					backend: infoResponse().backend,
					documents: null,
					outcome: "succeeded",
					startedAt: null,
					completedAt: null,
					data: {
						timestamp: 1,
						docName: "canvas",
						xml: '<Archive><items></items><chunks><chunk name="Definition"><chunks></chunks></chunk></chunks></Archive>',
						selectedInstanceGuids: [],
					},
					error: null,
				}),
			}),
		}),
	);
	assert.deepEqual(
		{ ok: response.ok, outcome: response.outcome, message: response.message, error: response.error },
		{
			ok: true,
			outcome: "succeeded",
			message: response.message,
			error: null,
		},
	);
	assert.equal(response.operation, "gh_get_canvas");
});

test("call rejects invalid input with a structured usage error", async () => {
	const io = memoryIO('{"selectionOnly":123}');
	const response = await handleCall(
		{
			kind: "call",
			operation: "gh_get_canvas",
			input: { kind: "inline", json: '{"selectionOnly":123}' },
			allowCapture: false,
			json: true,
		},
		deps(io),
	);
	assert.equal(response.ok, false);
	assert.equal(response.error?.code, "invalid_input");
});

test("call refuses capture without the allow flag", async () => {
	const io = memoryIO("{}");
	const response = await handleCall(
		{
			kind: "call",
			operation: "rh_capture_view",
			input: { kind: "inline", json: "{}" },
			allowCapture: false,
			json: true,
		},
		deps(io),
	);
	assert.equal(response.ok, false);
	assert.match(response.message, /capture/i);
});

test("runCli writes exactly one JSON document for bad usage", async () => {
	const io = memoryIO();
	const code = await runCli(["call", "gh_get_canvas"], io as never);
	assert.equal(code, 2);
	const documents = io.stdoutText.trim().split("\n");
	assert.equal(documents.length, 1);
	const parsed = JSON.parse(documents[0]!);
	assert.equal(parsed.ok, false);
	assert.equal(parsed.error.code, "invalid_command");
});

test("runCli writes one JSON document for unknown operations", async () => {
	const io = memoryIO();
	const code = await runCli(["call", "does_not_exist", "--data", "{}", "--json"], io as never);
	assert.equal(code, 2);
	const parsed = JSON.parse(io.stdoutText.trim());
	assert.equal(parsed.ok, false);
	assert.equal(parsed.error.code, "operation_not_found");
});

test("artifacts land under the configured root", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-artifacts-"));
	const { createArtifactWriter } = await import("../infra/artifact-writer.js");
	const writer = createArtifactWriter(root);
	const artifact = await writer.write({
		kind: "viewport_capture",
		mediaType: "image/png",
		bytes: Buffer.from([1, 2, 3, 4]),
		suggestedName: "../escape.png",
	});
	assert.ok(artifact.path.startsWith(root), "artifact must stay inside the root");
	assert.match(artifact.path, /escape\.png$/);
	assert.equal(artifact.byteLength, 4);
	await assert.rejects(
		writer.write({ kind: "viewport_capture", mediaType: "text/plain", bytes: Buffer.from("x") }),
		/Unsupported media type/,
	);
});
