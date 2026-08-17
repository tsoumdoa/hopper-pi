import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type {
	BackendClient,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
} from "../../core/contracts.js";
import { HopperCoreError } from "../../core/errors.js";
import { OperationRegistry, type OperationContext } from "../../core/operations.js";
import { ghEditParamOperation } from "./gh-edit-param.js";
import { ghParamRhinoOperation } from "./gh-param-rhino.js";

function context(options: {
	query?: (request: JsonObject) => Promise<JsonValue>;
	execute?: (request: JsonObject) => Promise<ExecuteActionsResponse>;
} = {}) {
	const queries: JsonObject[] = [];
	const executions: JsonObject[] = [];
	const query = (async (request: JsonObject) => {
		queries.push(request);
		return options.query?.(request) ?? {};
	}) as BackendClient["query"];
	const executeActions = async (request: JsonObject) => {
		executions.push(request);
		return options.execute?.(request) ?? {
			outcome: "succeeded" as const,
			data: null,
			error: null,
		};
	};
	const value: OperationContext = {
		signal: new AbortController().signal,
		requestId: "req_hybrid",
		session: null,
		backend: { query, executeActions },
		artifacts: { write: vi.fn() as never },
		reportProgress: vi.fn(),
		now: () => new Date(0),
	};
	return { value, queries, executions };
}

test("hybrid schemas reject empty items and scopes depend on mutation presence", () => {
	const registry = new OperationRegistry();
	registry.register(ghParamRhinoOperation);
	registry.register(ghEditParamOperation);
	assert.throws(
		() => registry.resolve("gh_param_rhino", { items: [] }),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "invalid_input",
	);
	assert.equal(registry.resolve("gh_param_rhino", {
		items: [{ action: "get", targetId: "param" }],
	}).scope, "none");
	assert.equal(registry.resolve("gh_param_rhino", {
		items: [
			{ action: "get", targetId: "param" },
			{ action: "reference", targetId: "param", rhinoObjectIds: ["object"] },
		],
	}).scope, "grasshopper");
	assert.equal(registry.resolve("gh_edit_param", {
		items: [{ action: "listParams", targetId: "script" }],
	}).scope, "none");
	assert.equal(registry.resolve("gh_edit_param", {
		items: [{ action: "removeInput", targetId: "script", name: "x" }],
	}).scope, "grasshopper");
});

test("prepareMutation rejects reads and maps gh_param_rhino mutation sources", async () => {
	await assert.rejects(
		ghParamRhinoOperation.prepareMutation!({ items: [{ action: "get", targetId: "param" }] }, context().value),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "operation_not_batchable",
	);

	const prepared = await ghParamRhinoOperation.prepareMutation!({ items: [
		{ action: "reference", targetId: "param", rhinoObjectIds: ["rhino-a"] },
		{ action: "internalize", targetId: "param", rhinoQuery: { layer: "Facade" } },
	] }, context().value);
	assert.equal(prepared.scope, "grasshopper");
	assert.deepEqual(prepared.actions, [
		{
			kind: "command",
			command: {
				action: "setParamRhinoGeometry",
				params: { targetId: "param", mode: "reference", rhinoObjectIds: ["rhino-a"] },
			},
		},
		{
			kind: "command",
			command: {
				action: "setParamRhinoGeometry",
				params: { targetId: "param", mode: "internalize", rhinoQuery: { layer: "Facade" } },
			},
		},
	]);

	const summary = ghParamRhinoOperation.summarizeInput({ items: [
		{ action: "reference", targetId: "param", rhinoObjectIds: ["secret-a", "secret-b"] },
	] });
	assert.equal(JSON.stringify(summary).includes("secret-a"), false);
});

test("gh_param_rhino merges mixed read and mutation results in original order", async () => {
	const events: string[] = [];
	const harness = context({
		query: async () => {
			events.push("read");
			return {
			targetId: "param-guid",
			paramName: "Geometry",
			volatileItems: [],
			persistentItems: [],
			};
		},
		execute: async () => {
			events.push("mutation");
			return { outcome: "succeeded", error: null, data: null };
		},
	});
	const response = await ghParamRhinoOperation.execute({ items: [
		{ action: "reference", targetId: "p1", rhinoObjectIds: ["r1"] },
		{ action: "get", targetId: "p2" },
		{ action: "internalize", targetId: "p3", rhinoQuery: { selectionOnly: true } },
	] }, harness.value);
	assert.equal(harness.queries.length, 1);
	assert.equal(harness.executions.length, 1);
	assert.equal((harness.executions[0]?.actions as JsonValue[]).length, 2);
	assert.deepEqual(events, ["read", "mutation"]);
	assert.deepEqual(response.data?.items.map((item) => [item.index, item.action]), [
		[0, "reference"],
		[1, "get"],
		[2, "internalize"],
	]);
});

test("a failed read before mutation stops later work and marks it skipped", async () => {
	const harness = context({ query: async () => ({ error: "read failed" }) });
	const response = await ghEditParamOperation.execute({ items: [
		{ action: "listParams", targetId: "script" },
		{ action: "addInput", targetId: "script", name: "x" },
	] }, harness.value);

	assert.equal(harness.executions.length, 0);
	assert.equal(response.outcome, "failed");
	assert.equal(response.error?.code, "operation_failed");
	assert.deepEqual(response.data?.items.map((item) => item.outcome), ["failed", "skipped"]);
});

test("a failed mixed-call read prevents every mutation", async () => {
	const events: string[] = [];
	const harness = context({
		execute: async () => {
			events.push("mutation");
			return { outcome: "succeeded", data: null, error: null };
		},
		query: async () => {
			events.push("read");
			return { error: "read failed" };
		},
	});
	const response = await ghEditParamOperation.execute({ items: [
		{ action: "addInput", targetId: "script", name: "x" },
		{ action: "listParams", targetId: "script" },
		{ action: "removeInput", targetId: "script", name: "y" },
	] }, harness.value);

	assert.deepEqual(events, ["read"]);
	assert.equal(harness.executions.length, 0);
	assert.equal(response.outcome, "failed");
	assert.equal(response.error?.code, "operation_failed");
	assert.deepEqual(response.data?.items.map((item) => item.outcome), [
		"skipped", "failed", "skipped",
	]);
});

test("an unknown mutation stops mixed execution and preserves unknown", async () => {
	const harness = context({
		execute: async () => ({
			outcome: "unknown",
			data: null,
			error: { code: "outcome_unknown", message: "queue state unknown", retryable: false },
		}),
		query: async () => ({
			targetId: "param",
			paramName: "Geometry",
			volatileItems: [],
			persistentItems: [],
		}),
	});
	const response = await ghParamRhinoOperation.execute({ items: [
		{ action: "reference", targetId: "p1", rhinoObjectIds: ["r1"] },
		{ action: "get", targetId: "p2" },
		{ action: "internalize", targetId: "p3", rhinoObjectIds: ["r3"] },
	] }, harness.value);

	assert.equal(harness.executions.length, 1);
	assert.equal(harness.queries.length, 1);
	assert.equal(response.outcome, "unknown");
	assert.equal(response.error?.code, "outcome_unknown");
	assert.deepEqual(response.data?.items.map((item) => item.outcome), [
		"skipped", "succeeded", "skipped",
	]);
	assert.match(response.data?.items[0]?.message ?? "", /outcome unknown/);
});

test("mutation-only execution retains one batched executeActions request", async () => {
	const harness = context({
		execute: async () => ({ outcome: "succeeded", data: null, error: null }),
	});
	const response = await ghEditParamOperation.execute({ items: [
		{ action: "addInput", targetId: "script", name: "x" },
		{ action: "removeOutput", targetId: "script", name: "y" },
	] }, harness.value);

	assert.equal(response.outcome, "succeeded");
	assert.equal(harness.executions.length, 1);
	assert.equal((harness.executions[0]?.actions as JsonValue[]).length, 2);
});

test("gh_edit_param prepares exact command mappings and rejects read batches", async () => {
	await assert.rejects(
		ghEditParamOperation.prepareMutation!({
			items: [
				{ action: "addInput", targetId: "script", name: "x" },
				{ action: "listParams", targetId: "script" },
			],
		}, context().value),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "operation_not_batchable",
	);
	const prepared = await ghEditParamOperation.prepareMutation!({ items: [
		{ action: "syncParams", targetId: "script", inputs: [], outputs: [{ name: "A" }] },
		{ action: "addInput", targetId: "script", name: "x", access: "tree" },
		{ action: "removeOutput", targetId: "script", name: "old" },
	] }, context().value);
	assert.deepEqual(prepared.actions.map((action) =>
		(action.command as JsonObject).action), [
		"syncScriptParams", "addScriptInput", "removeScriptOutput",
	]);
	assert.deepEqual((prepared.actions[0]?.command as JsonObject).params, {
		targetId: "script",
		inputs: [],
		outputs: [{ name: "A" }],
	});
	assert.deepEqual((prepared.actions[1]?.command as JsonObject).params, {
		targetId: "script",
		name: "x",
		access: "tree",
	});
});

test("gh_edit_param executes reads without a mutation and preserves mixed item indexes", async () => {
	const readOnly = context({ query: async () => ({ inputs: [{ name: "x" }], outputs: [] }) });
	const readResponse = await ghEditParamOperation.execute({
		items: [{ action: "listParams", targetId: "script" }],
	}, readOnly.value);
	assert.equal(readResponse.outcome, "succeeded");
	assert.equal(readOnly.executions.length, 0);
	assert.deepEqual(readResponse.data?.items[0]?.data, { inputs: [{ name: "x" }], outputs: [] });

	const mixed = context({
		query: async () => ({ inputs: [], outputs: [] }),
		execute: async () => ({ outcome: "succeeded", data: null, error: null }),
	});
	const mixedResponse = await ghEditParamOperation.execute({ items: [
		{ action: "addInput", targetId: "script", name: "a" },
		{ action: "listParams", targetId: "script" },
		{ action: "removeInput", targetId: "script", name: "b" },
	] }, mixed.value);
	assert.deepEqual(mixedResponse.data?.items.map((item) => [item.index, item.action]), [
		[0, "addInput"], [1, "listParams"], [2, "removeInput"],
	]);
});
