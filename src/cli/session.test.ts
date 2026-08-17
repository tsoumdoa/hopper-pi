import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "vitest";
import type { BackendClient } from "../protocol/backend-client.js";
import type {
	CaptureCheckpointRequest,
	CaptureCheckpointResponse,
	ExecuteActionsRequest,
	ExecuteActionsResponse,
	GetBackendInfoResponse,
	GetRequestStatusResponse,
	QueryBackendRequest,
	QueryBackendResponse,
	RestoreCheckpointRequest,
	RestoreCheckpointResponse,
	WireResponse,
} from "../protocol/wire.js";
import type { JsonValue, RequestId } from "../core/contracts.js";
import { createOperationRegistry } from "../operations/index.js";
import type { CliIO } from "./io.js";
import { handleCall, type CliDependencies } from "./handlers.js";
import { handleHistory, handleSession } from "./session-handlers.js";
import { SessionStore } from "../session/store.js";
import { CheckpointStore } from "../session/checkpoints.js";

const BACKEND_ID = "be_01TESTBACKEND000000000000" as const;
const GH_ID = "ghd_01TESTCANVAS000000000000" as const;
const RHINO_ID = "rhd_01TESTRHINO0000000000000" as const;

type FakeClient = BackendClient & {
	executeActionsRequests: ExecuteActionsRequest[];
	statusResponses: Map<string, GetRequestStatusResponse>;
};

function wireResponse<T extends JsonValue>(
	type: string,
	requestId: RequestId,
	outcome: string,
	data: T | null,
	error: WireResponse["error"] = null,
): WireResponse<T> {
	return {
		protocolVersion: 1,
		type,
		requestId,
		backend: {
			backendId: BACKEND_ID,
			backendStartedAt: "2026-08-15T00:00:00.000Z",
			pluginVersion: "1.0.0",
			protocolVersion: 1,
		},
		documents: {
			grasshopper: { documentId: GH_ID, displayName: "canvas.gh", path: null },
			rhino: { documentId: RHINO_ID, runtimeSerialNumber: 3, displayName: "m.3dm", path: null },
		},
		outcome: outcome as WireResponse["outcome"],
		startedAt: null,
		completedAt: null,
		data,
		error,
	};
}

function fakeClient(overrides: {
	documents?: GetBackendInfoResponse["documents"];
	executeResponse?: (request: ExecuteActionsRequest) => ExecuteActionsResponse;
} = {}): FakeClient {
	const client: FakeClient = {
		executeActionsRequests: [],
		statusResponses: new Map(),
		async getInfo(): Promise<GetBackendInfoResponse> {
			return wireResponse("getBackendInfo", "req_01MINFO000000000000000000", "succeeded", {
				capabilities: ["query", "executeActions"],
				maxRequestBytes: 1,
				maxCheckpointBytes: 1,
				deduplicationWindowMs: 1,
			});
		},
		async query<T extends JsonValue>(request: QueryBackendRequest): Promise<QueryBackendResponse<T>> {
			throw new Error(`unexpected query ${(request as { type: string }).type}`);
		},
		async getRequestStatus(requestId: string): Promise<GetRequestStatusResponse> {
			const cached = client.statusResponses.get(requestId);
			if (cached) return cached;
			return wireResponse("getRequestStatus", requestId as RequestId, "succeeded", {
				targetRequestId: requestId as RequestId,
				state: "not_found",
				cachedResponse: null,
			});
		},
		async executeActions(request: ExecuteActionsRequest): Promise<ExecuteActionsResponse> {
			client.executeActionsRequests.push(request);
			return overrides.executeResponse?.(request)
				?? wireResponse("executeActions", request.requestId, "succeeded", {
					payloadSha256: request.payloadSha256,
					actions: [],
					transaction: {
						outcome: "committed",
						grasshopperUndoRecorded: true,
						rhinoUndoRecorded: false,
						grasshopperRolledBack: false,
						rhinoRolledBack: false,
						limitations: [],
					},
					canvasDigestBefore: null,
					canvasDigestAfter: null,
					elapsedMs: 1,
				});
		},
		async captureCheckpoint(request: CaptureCheckpointRequest): Promise<CaptureCheckpointResponse> {
			const bytes = Buffer.from("checkpoint-bytes");
			return wireResponse("captureCheckpoint", request.requestId, "succeeded", {
				schemaVersion: 1,
				checkpointId: `cp_${request.requestId.slice(-8)}`,
				backendId: BACKEND_ID,
				grasshopperDocumentId: request.body.expectedGrasshopperDocumentId,
				capturedAt: "2026-08-15T00:00:00.000Z",
				encoding: "base64",
				compression: "none",
				bytes: bytes.toString("base64"),
				byteLength: bytes.byteLength,
				binarySha256: createHash("sha256").update(bytes).digest("hex"),
				canvasDigest: "digest-live",
				canonicalCanvas: { objects: [], wires: [], groups: [] },
			});
		},
		async restoreCheckpoint(request: RestoreCheckpointRequest): Promise<RestoreCheckpointResponse> {
			return wireResponse("restoreCheckpoint", request.requestId, "succeeded", {
				restoredCheckpointId: request.body.checkpoint.checkpointId,
				previousCanvasDigest: request.body.expectedLiveCanvasDigest,
				currentCanvasDigest: request.body.checkpoint.canvasDigest,
				grasshopperUndoRecorded: true,
			});
		},
		async close() {},
	};
	return client;
}

function memoryIO(stdin = "{}") {
	const state = { stdoutText: "" };
	return {
		stdin: Readable.from(stdin),
		stdout: new Writable({
			write(chunk, _enc, cb) {
				state.stdoutText += chunk.toString();
				cb();
			},
		}),
		stderr: new Writable(),
		env: {},
		cwd: tmpdir(),
		stdoutText: state,
	} as unknown as CliIO & { stdoutText: { stdoutText: string } };
}

async function makeDeps(overrides: {
	client?: FakeClient;
} = {}): Promise<{ deps: CliDependencies; client: FakeClient; root: string; io: CliIO }> {
	const root = await mkdtemp(join(tmpdir(), "hopper-cli-session-"));
	const client = overrides.client ?? fakeClient();
	const io = memoryIO();
	const deps = {
		registry: createOperationRegistry(),
		connection: () => ({
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults" as const,
			profilePath: "/tmp/none.json",
		}),
		createProtocolClient: () => client,
		stateRoot: root,
		sessions: new SessionStore(root),
		checkpoints: new CheckpointStore(root),
		io,
		now: () => new Date(),
	} as CliDependencies;
	return { deps, client, root, io };
}

const WIRE_INPUT = JSON.stringify({
	items: [{
		action: "connect",
		fromComponent: "11111111-1111-1111-1111-111111111111",
		fromPort: "22222222-2222-2222-2222-222222222222",
		toComponent: "33333333-3333-3333-3333-333333333333",
		toPort: "44444444-4444-4444-4444-444444444444",
	}],
});

test("session start binds to the live documents", async () => {
	const { deps } = await makeDeps();
	const response = await handleSession(
		{ kind: "session.start", name: "pavilion", captureAllowed: false, json: true },
		deps,
	);
	assert.equal(response.ok, true);
	assert.match(response.sessionId ?? "", /^hs_/);
	const stored = await deps.sessions.list();
	assert.equal(stored.length, 1);
});

test("mutations refuse to run without a session", async () => {
	const { deps } = await makeDeps();
	const response = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(response.ok, false);
	assert.equal(response.error?.code, "invalid_input");
	assert.match(response.error?.message ?? "", /--session/);
});

test("session-bound mutation verifies binding, reserves edits, and journals", async () => {
	const { deps, client, root } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;

	const call = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);

	assert.equal(call.ok, true, call.message);
	assert.equal(call.editId, "edit_000001");
	assert.equal(client.executeActionsRequests.length, 1);
	const wire = client.executeActionsRequests[0]!;
	assert.equal(wire.body.expectedBackendId, BACKEND_ID);
	assert.equal(wire.body.expectedGrasshopperDocumentId, GH_ID);
	assert.equal(wire.body.scope, "grasshopper");
	assert.match(wire.payloadSha256 ?? "", /^[0-9a-f]{64}$/);

	const storedRequest = await deps.sessions.readRequest(sessionId, wire.requestId);
	assert.equal(storedRequest.payloadSha256, wire.payloadSha256);
	const journal = await readFile(join(root, "sessions", sessionId, "events.jsonl"), "utf8");
	assert.match(journal, /request\.started/);
	assert.match(journal, /request\.outcome/);

	const list = await handleHistory({ kind: "history.list", sessionId, json: true }, deps);
	assert.equal(list.ok, true);
	const edits = (list.data as { edits: Array<{ editId: string; state: string }> }).edits;
	assert.equal(edits.length, 1);
	assert.equal(edits[0]?.state, "succeeded");
});

test("an after-checkpoint digest race is a partial mutation", async () => {
	const client = fakeClient({
		executeResponse: (request) => wireResponse("executeActions", request.requestId, "succeeded", {
			payloadSha256: request.payloadSha256,
			actions: [],
			transaction: {
				outcome: "committed",
				grasshopperUndoRecorded: true,
				rhinoUndoRecorded: false,
				grasshopperRolledBack: false,
				rhinoRolledBack: false,
				limitations: [],
			},
			canvasDigestBefore: "digest-live",
			canvasDigestAfter: "digest-execution",
			elapsedMs: 1,
		}),
	});
	const { deps } = await makeDeps({ client });
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const response = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId: session.sessionId as `hs_${string}`,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(response.ok, false);
	assert.equal(response.outcome, "partial");
	assert.equal(response.error?.code, "partial_mutation");
});

test("a changed Grasshopper document rejects before mutation", async () => {
	const { deps, client } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;

	// Simulate a document switch after binding.
	const original = client.getInfo.bind(client);
	client.getInfo = async () => {
		const info = await original();
		return {
			...info,
			documents: {
				...info.documents!,
				grasshopper: { ...info.documents!.grasshopper, documentId: "ghd_01OTHER000000000000000000" as const },
			},
		};
	};

	const response = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(response.ok, false);
	assert.equal(response.error?.code, "document_conflict");
	assert.equal(client.executeActionsRequests.length, 0);
});

test("closed sessions reject mutations", async () => {
	const { deps } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;
	await handleSession({ kind: "session.close", sessionId, json: true }, deps);

	const response = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(response.ok, false);
	assert.equal(response.error?.code, "session_locked");
});

test("session rebind records the transition and unblocks calls", async () => {
	const { deps, client, root } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;

	const rebind = await handleSession({ kind: "session.rebind", sessionId, json: true }, deps);
	assert.equal(rebind.ok, true);
	const journal = await readFile(join(root, "sessions", sessionId, "events.jsonl"), "utf8");
	assert.match(journal, /session\.rebound/);
	assert.equal(client.executeActionsRequests.length, 0);
});

test("reconcile resolves an unknown edit from backend evidence", async () => {
	const { deps, client, root } = await makeDeps({
		client: fakeClient({
			executeResponse: () => ({
				...wireResponse("executeActions", "req_01TIMEOUTREQ0000000000000" as RequestId, "unknown", null, {
					code: "outcome_unknown",
					message: "timed out",
					retryable: true,
				}),
			}),
		}),
	});
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;
	const call = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(call.outcome, "unknown");

	const requestId = client.executeActionsRequests[0]!.requestId;
	client.statusResponses.set(requestId, wireResponse("getRequestStatus", requestId, "succeeded", {
		targetRequestId: requestId,
		state: "succeeded",
		cachedResponse: wireResponse("executeActions", requestId, "succeeded", null),
	}));

	const reconciled = await handleHistory(
		{ kind: "history.reconcile", sessionId, editId: "edit_000001", json: true },
		deps,
	);
	assert.equal(reconciled.ok, true);
	assert.equal(reconciled.outcome, "succeeded");

	const journal = await readFile(join(root, "sessions", sessionId, "events.jsonl"), "utf8");
	const outcomes = journal.split("\n").filter((line) => line.includes("request.outcome"));
	assert.equal(outcomes.length, 2);
	assert.match(outcomes[1]!, /succeeded/);
});

test("history show reports unknown edits", async () => {
	const { deps } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;
	const missing = await handleHistory(
		{ kind: "history.show", sessionId, editId: "edit_000001", json: true },
		deps,
	);
	assert.equal(missing.ok, false);
	assert.equal(missing.error?.code, "request_not_found");
});

test("grasshopper mutations capture checkpoints and support undo/diff", async () => {
	const { deps, client } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;
	const call = await handleCall({
		kind: "call",
		operation: "gh_edit_wire",
		sessionId,
		input: { kind: "inline", json: WIRE_INPUT },
		allowCapture: false,
		json: true,
	}, deps);
	assert.equal(call.ok, true, call.message);
	assert.equal(client.executeActionsRequests[0]?.body.expectedCanvasDigest, "digest-live");

	const diff = await handleHistory({ kind: "history.diff", sessionId, editId: "edit_000001", json: true }, deps);
	assert.equal(diff.ok, true, diff.message);

	const undo = await handleHistory({ kind: "history.undo", sessionId, editId: "edit_000001", json: true }, deps);
	assert.equal(undo.ok, true, undo.message);
	assert.equal(undo.editId, "edit_000002");
});

test("rhino-scoped history edits refuse durable undo", async () => {
	const { deps } = await makeDeps();
	const session = await handleSession(
		{ kind: "session.start", captureAllowed: false, json: true },
		deps,
	);
	const sessionId = session.sessionId as `hs_${string}`;
	const { Journal } = await import("../session/journal.js");
	await Journal.forSession(deps.stateRoot, sessionId).append({
		schemaVersion: 1,
		eventType: "request.started",
		eventId: "evt_1",
		sessionId,
		editId: "edit_000001",
		requestId: "req_01R",
		occurredAt: "2026-08-16T00:00:00.000Z",
		operation: "rh_run_script",
		mutationScope: "rhino",
		inputSummary: {},
		backendId: BACKEND_ID,
		grasshopperDocumentId: GH_ID,
		rhinoDocumentId: RHINO_ID,
		beforeCheckpointId: null,
	});
	await Journal.forSession(deps.stateRoot, sessionId).append({
		schemaVersion: 1,
		eventType: "request.outcome",
		eventId: "evt_2",
		sessionId,
		editId: "edit_000001",
		requestId: "req_01R",
		occurredAt: "2026-08-16T00:00:01.000Z",
		outcome: "succeeded",
		resultSummary: {},
		error: null,
		warnings: [],
		afterCheckpointId: null,
		diff: null,
		durationMs: 1,
	});
	const undo = await handleHistory({ kind: "history.undo", sessionId, editId: "edit_000001", json: true }, deps);
	assert.equal(undo.ok, false);
	assert.equal(undo.error?.code, "unsupported_undo");
});
