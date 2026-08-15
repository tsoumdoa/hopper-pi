import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import type { ApplyGraphResult } from "../../types/gh-apply-graph.js";
import {
	createLegacyBackendClient,
	createLegacyPiOperationContext,
	createLegacyRequestId,
	createTemporaryArtifactWriter,
} from "./legacy-context.js";

function successfulGraph(): ApplyGraphResult {
	return {
		ok: true,
		rolledBack: false,
		timedOut: false,
		counts: { components: 1, widgets: 0, scripts: 0, wires: 0, groups: 0 },
		refs: { component: "short-id" },
		structuralErrors: [],
		runtimeMessages: [],
		overlaps: null,
		elapsedMs: 10,
	};
}

function dependencies(overrides: Record<string, unknown> = {}) {
	return {
		query: async <T extends JsonValue>(request: JsonObject) => request as T,
		executeApplyGraph: async () => successfulGraph(),
		submitCommand: async () => ({ jobId: "job_default" }),
		...overrides,
	} as any;
}

test("legacy queries forward the current request message unchanged", async () => {
	const seen: JsonObject[] = [];
	const backend = createLegacyBackendClient(dependencies({
		query: async (request: JsonObject) => {
			seen.push(request);
			return { type: "getCurrentCanvas.response", xml: "<xml />" };
		},
	}));
	const request = { type: "getCurrentCanvas", selectionOnly: true };
	const response = await backend.query<JsonObject>(request);

	assert.deepEqual(seen, [request]);
	assert.equal(response.type, "getCurrentCanvas.response");
});

test("applyGraph runs synchronously and returns terminal structured data", async () => {
	let seenInput: unknown;
	const backend = createLegacyBackendClient(dependencies({
		executeApplyGraph: async (input: unknown) => {
			seenInput = input;
			return successfulGraph();
		},
	}));
	const input = { components: [{ ref: "a", type: "Addition", x: 20, y: 20 }] };
	const response = await backend.executeActions({
		actions: [{ kind: "applyGraph", input }],
	});

	assert.deepEqual(seenInput, input);
	assert.equal(response.outcome, "succeeded");
	assert.equal(response.error, null);
	assert.deepEqual((response.data as JsonObject).refs, { component: "short-id" });
});

test("applyGraph timeout stays unknown", async () => {
	const backend = createLegacyBackendClient(dependencies({
		executeApplyGraph: async () => ({ ...successfulGraph(), ok: false, timedOut: true }),
	}));
	const response = await backend.executeActions({
		actions: [{ kind: "applyGraph", input: { widgets: [] } }],
	});

	assert.equal(response.outcome, "unknown");
	assert.equal(response.error?.code, "outcome_unknown");
	assert.equal(response.error?.retryable, false);
});

test("command actions submit sequentially and queue acceptance returns unknown", async () => {
	const calls: Array<{ action: string; params: JsonObject }> = [];
	const backend = createLegacyBackendClient(dependencies({
		submitCommand: async (action: string, params: JsonObject) => {
			calls.push({ action, params });
			return { jobId: `job_${calls.length}` };
		},
	}));
	const response = await backend.executeActions({ actions: [
		{ kind: "command", command: { action: "moveComponent", params: { targetId: "one" } } },
		{ kind: "command", command: { action: "deleteComponent", params: { targetId: "two" } } },
	] });

	assert.deepEqual(calls, [
		{ action: "moveComponent", params: { targetId: "one" } },
		{ action: "deleteComponent", params: { targetId: "two" } },
	]);
	assert.equal(response.outcome, "unknown");
	assert.equal(response.error?.code, "outcome_unknown");
	assert.equal(response.error?.retryable, false);
	assert.deepEqual(response.error?.details?.submittedJobIds, ["job_1", "job_2"]);
});

test("a failed submission after a queued job remains unknown", async () => {
	let count = 0;
	const backend = createLegacyBackendClient(dependencies({
		submitCommand: async () => {
			count++;
			if (count === 2) throw new Error("publisher failed");
			return { jobId: "job_1" };
		},
	}));
	const response = await backend.executeActions({ actions: [
		{ kind: "command", command: { action: "moveComponent", params: { targetId: "one" } } },
		{ kind: "command", command: { action: "deleteComponent", params: { targetId: "two" } } },
	] });

	assert.equal(response.outcome, "unknown");
	assert.match(response.error?.message ?? "", /publisher failed/);
});

test("temporary artifacts ignore path traversal and return verified metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-legacy-context-test-"));
	const writer = createTemporaryArtifactWriter(root);
	const bytes = Buffer.from("safe artifact bytes");
	const artifact = await writer.write({
		kind: "viewport_capture",
		bytes,
		mediaType: "image/png",
		suggestedName: "../../backend-supplied.png",
	});

	assert.equal(dirname(artifact.path), root);
	assert.match(artifact.path, /backend-supplied\.png$/);
	assert.deepEqual(await readFile(artifact.path), bytes);
	assert.equal(artifact.byteLength, bytes.byteLength);
	assert.equal(artifact.sha256, "25447bcc92d6037d3e41351c9f819eb9a56ba6516c33d61d4c63cdd1240c00ba");
});

test("legacy context supplies a ULID request ID and consent-derived capture flag", () => {
	const fixedNow = new Date("2026-08-15T00:00:00.000Z");
	const artifactWriter = createTemporaryArtifactWriter(join(tmpdir(), "hopper-context-test"));
	const context = createLegacyPiOperationContext({
		toolCallId: "call_1",
		signal: new AbortController().signal,
		piContext: {} as never,
		reportProgress: () => {},
	}, {
		...dependencies(),
		captureAllowed: () => true,
		artifactWriter,
		now: () => fixedNow,
	});

	assert.match(context.requestId, /^req_[0-9A-HJKMNP-TV-Z]{26}$/);
	assert.equal(context.requestId.slice(4, 14), createLegacyRequestId(fixedNow).slice(4, 14));
	assert.equal(context.captureAllowed, true);
	assert.equal(context.session, null);
	assert.equal(context.artifacts, artifactWriter);
});
