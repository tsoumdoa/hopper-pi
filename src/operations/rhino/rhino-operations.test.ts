import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type {
	ArtifactRecord,
	BackendClient,
	JsonObject,
	JsonValue,
} from "../../core/contracts.js";
import { OperationRegistry, type OperationContext } from "../../core/operations.js";
import { rhCaptureViewOperation } from "./rh-capture-view.js";
import { rhQueryObjectsOperation } from "./rh-query-objects.js";
import { rhRunScriptOperation } from "./rh-run-script.js";
import { rhViewControlOperation } from "./rh-view-control.js";

type QueryImplementation = (request: JsonObject) => Promise<JsonValue>;

function makeContext(
	queryImplementation: QueryImplementation,
	options: {
		captureAllowed?: boolean;
		executeActions?: BackendClient["executeActions"];
	} = {},
) {
	const requests: JsonObject[] = [];
	const writes: Array<{ kind: string; contents: Uint8Array; mediaType: string }> = [];
	const query = (async (request: JsonObject) => {
		requests.push(request);
		return queryImplementation(request);
	}) as BackendClient["query"];
	const artifact: ArtifactRecord = {
		artifactId: "artifact_1",
		kind: "viewport_capture",
		path: "artifacts/rhino-view.png",
		mediaType: "image/png",
		byteLength: 3,
		sha256: "abc123",
	};
	const context: OperationContext = {
		signal: new AbortController().signal,
		requestId: "req_test",
		session: null,
		captureAllowed: options.captureAllowed,
		backend: {
			query,
			executeActions: async (request, signal) => {
				requests.push(request);
				return options.executeActions?.(request, signal)
					?? { outcome: "succeeded", data: null, error: null };
			},
		},
		artifacts: {
			write: async (writeOptions) => {
				writes.push({
					kind: writeOptions.kind,
					contents: writeOptions.bytes,
					mediaType: writeOptions.mediaType,
				});
				return artifact;
			},
		},
		reportProgress: vi.fn(),
		now: () => new Date(0),
	};
	return { context, requests, writes, artifact };
}

function registry() {
	const registry = new OperationRegistry();
	registry.register(rhRunScriptOperation);
	registry.register(rhQueryObjectsOperation);
	registry.register(rhViewControlOperation);
	registry.register(rhCaptureViewOperation);
	return registry;
}

const metadata = {
	viewName: "Perspective",
	viewportId: "viewport-1",
	projection: "perspective",
	cameraLocation: { x: 1, y: 2, z: 3 },
	cameraTarget: { x: 0, y: 0, z: 0 },
	cameraDirection: { x: -1, y: -2, z: -3 },
	cameraUp: { x: 0, y: 0, z: 1 },
	lensLength: 50,
	cplaneName: "World Top",
	cplaneOrigin: { x: 0, y: 0, z: 0 },
};

test("Rhino operation registry exposes the planned scopes", () => {
	const operations = registry();
	assert.equal(operations.resolve("rh_run_script", {
		items: [{ mode: "python", source: "print('ok')" }],
	}).scope, "rhino");
	assert.equal(operations.resolve("rh_query_objects", {}).scope, "none");
	assert.equal(operations.resolve("rh_view_control", { action: "cplaneView" }).scope, "viewport");
	assert.equal(operations.resolve("rh_capture_view", {}).scope, "none");
});

test("rh_run_script redacts source and returns structured item results", async () => {
	const { context, requests } = makeContext(async () => null, {
		executeActions: async () => ({
			outcome: "succeeded",
			data: { actions: [{
				outcome: "succeeded",
				message: "Script completed.",
				data: { ok: true, output: "42", error: "" },
			}] },
			error: null,
		}),
	});
	const input = { items: [{ mode: "python" as const, source: "print(42)\n", echo: true }] };
	const summary = rhRunScriptOperation.summarizeInput(input);
	assert.equal(JSON.stringify(summary).includes("print(42)"), false);
	assert.deepEqual(Object.keys((summary.items as JsonObject[])[0]!).sort(), [
		"byteLength", "lineCount", "mode", "sha256",
	]);

	const response = await registry().execute(
		registry().resolve("rh_run_script", input),
		context,
	);
	assert.equal(response.outcome, "succeeded");
	assert.deepEqual(response.data, {
		items: [{
			index: 0,
			mode: "python",
			outcome: "succeeded",
			output: "42",
			echoed: false,
			error: null,
		}],
	});
	const actions = requests[0]?.actions as JsonObject[];
	assert.equal((actions[0]?.input as JsonObject).source, "print(42)\n");
});

test("rh_run_script validates all sources before sending and reports mixed results as partial", async () => {
	const invalid = makeContext(async () => null);
	const invalidResponse = await rhRunScriptOperation.execute({
		items: [{ mode: "command", source: "_-Exit" }],
	}, invalid.context);
	assert.equal(invalidResponse.error?.code, "invalid_input");
	assert.equal(invalid.requests.length, 0);

	const mixed = makeContext(async () => null, {
		executeActions: async () => ({
			outcome: "failed",
			data: { actions: [
				{ outcome: "succeeded", message: "created", data: { ok: true, output: "created", error: "" } },
				{ outcome: "failed", message: "script failed", data: { ok: false, output: "", error: "script failed" } },
			] },
			error: { code: "operation_failed", message: "script failed", retryable: false },
		}),
	});
	const response = await rhRunScriptOperation.execute({
		items: [
			{ mode: "python", source: "print(1)" },
			{ mode: "csharp", source: "Console.WriteLine(2);" },
		],
	}, mixed.context);
	assert.equal(response.outcome, "failed");
	assert.equal(response.error?.code, "operation_failed");
	assert.equal(response.data?.items.length, 2);
});

test("rh_run_script preserves an unknown atomic request", async () => {
	let calls = 0;
	const timedOut = makeContext(async () => null, {
		executeActions: async () => {
			calls += 1;
			return {
				outcome: "unknown",
				data: null,
				error: { code: "outcome_unknown", message: "request timed out after send", retryable: true },
			};
		},
	});
	const response = await rhRunScriptOperation.execute({
		items: [
			{ mode: "python", source: "print(1)" },
			{ mode: "python", source: "print(2)" },
			{ mode: "python", source: "print(3)" },
		],
	}, timedOut.context);
	assert.equal(calls, 1);
	assert.equal(response.outcome, "unknown");
	assert.equal(response.error?.code, "outcome_unknown");
	assert.equal(response.error?.retryable, true);
	assert.deepEqual(response.data?.items.map((item) => item.outcome), [
		"unknown",
		"unknown",
		"unknown",
	]);
	assert.equal(response.data?.items[0]?.error, "request timed out after send");
	assert.equal(response.data?.items[1]?.error, "request timed out after send");
});

test("rh_query_objects preserves filters and returns count or paginated objects", async () => {
	const objects = [
		{ objectId: "a", name: "A", layer: "L", objectType: "curve" },
		{ objectId: "b", name: "B", layer: "L", objectType: "mesh" },
		{ objectId: "c", name: "C", layer: "L", objectType: "point" },
	];
	const paged = makeContext(async () => ({ objects }));
	const page = await rhQueryObjectsOperation.execute({ layer: "L", limit: 1, offset: 1 }, paged.context);
	assert.deepEqual(page.data, { objects: [objects[1]], total: 3 });
	assert.equal(paged.requests[0]?.layer, "L");
	assert.equal("limit" in paged.requests[0]!, false);

	const counted = makeContext(async () => ({ objects }));
	const count = await rhQueryObjectsOperation.execute({ countOnly: true }, counted.context);
	assert.deepEqual(count.data, { objects: [], total: 3 });
});

test("rh_view_control applies semantic checks and returns structured metadata", async () => {
	const blocked = makeContext(async () => null);
	const invalid = await rhViewControlOperation.execute({ action: "camera", camera: {} }, blocked.context);
	assert.equal(invalid.error?.code, "invalid_input");
	assert.equal(blocked.requests.length, 0);

	const allowed = makeContext(async () => null, {
		executeActions: async () => ({
			outcome: "succeeded",
			data: { actions: [{ outcome: "succeeded", message: "View updated", data: { ok: true, message: "View updated", metadata } }] },
			error: null,
		}),
	});
	const response = await rhViewControlOperation.execute({
		action: "camera",
		camera: { lensLength: 35 },
	}, allowed.context);
	assert.equal(response.outcome, "succeeded");
	assert.deepEqual(response.data, { message: "View updated", metadata });
});

test("rh_capture_view requires context permission, clamps dimensions, and writes an artifact", async () => {
	const denied = makeContext(async () => null, { captureAllowed: false });
	const deniedResponse = await rhCaptureViewOperation.execute({}, denied.context);
	assert.equal(deniedResponse.outcome, "failed");
	assert.equal(denied.requests.length, 0);

	const allowed = makeContext(async () => ({
		ok: true,
		imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
		mediaType: "image/png",
		metadata,
	}), { captureAllowed: true });
	const response = await rhCaptureViewOperation.execute({
		view: "  top  ",
		width: 99999,
		height: 1,
	}, allowed.context);
	assert.equal(response.outcome, "succeeded");
	assert.equal(allowed.requests[0]?.view, "top");
	assert.equal(allowed.requests[0]?.width, 2000);
	assert.equal(allowed.requests[0]?.height, 64);
	assert.deepEqual([...allowed.writes[0]!.contents], [1, 2, 3]);
	assert.deepEqual(response.artifacts, [allowed.artifact]);
	assert.deepEqual(response.data, { artifact: allowed.artifact, metadata });
});
