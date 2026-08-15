import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, vi } from "vitest";
import {
	PR1_EXCLUDED_TOOL_NAMES,
	PR1_INPUT_SCHEMA_GOLDEN,
	PR1_PUBLIC_OPERATION_NAMES,
} from "../contracts/pr1-operation-input-schema-golden.js";
import {
	PR1_OPERATION_REGISTRY_GOLDEN,
	type Pr1OperationName,
} from "../contracts/pr1-operation-registry-golden.js";
import type {
	BackendClient,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
} from "../core/contracts.js";
import type { OperationContext } from "../core/operations.js";
import { HOPPER_OPERATIONS, createOperationRegistry } from "./index.js";

function schemaDigest(schema: JsonObject) {
	const json = JSON.stringify(schema);
	return {
		sha256: createHash("sha256").update(json, "utf8").digest("hex"),
		byteLength: Buffer.byteLength(json, "utf8"),
	};
}

function context(options: {
	query?: (request: JsonObject) => Promise<JsonValue>;
	execute?: (request: JsonObject) => Promise<ExecuteActionsResponse>;
} = {}): OperationContext {
	const query = (async (request: JsonObject) =>
		options.query?.(request) ?? {}) as BackendClient["query"];
	return {
		signal: new AbortController().signal,
		requestId: "req_registry",
		session: null,
		backend: {
			query,
			executeActions: async (request) => options.execute?.(request) ?? ({
				outcome: "succeeded",
				data: null,
				error: null,
			}),
		},
		artifacts: { write: vi.fn() as never },
		reportProgress: vi.fn(),
		now: () => new Date(0),
	};
}

test("runtime registry contains exactly the 16 frozen public operations", () => {
	const names = HOPPER_OPERATIONS.map((operation) => operation.name);
	assert.deepEqual(names, [...PR1_PUBLIC_OPERATION_NAMES]);
	assert.equal(new Set(names).size, 16);

	const registryNames = createOperationRegistry().list().map((entry) => entry.name);
	assert.deepEqual(registryNames, names);
	const registeredNameSet = new Set<string>(registryNames);
	for (const excluded of PR1_EXCLUDED_TOOL_NAMES) {
		assert.equal(registeredNameSet.has(excluded), false);
	}
});

test("descriptions, groups, scopes, and batchability match the PR 1 registry golden", () => {
	const actual = Object.fromEntries(
		createOperationRegistry().list().map((entry) => [entry.name, {
			description: entry.description,
			group: entry.group,
			possibleScopes: entry.possibleScopes,
			batchable: entry.batchable,
		}]),
	);
	const expected = Object.fromEntries(
		Object.entries(PR1_OPERATION_REGISTRY_GOLDEN).map(([name, entry]) => [name, {
			description: entry.description,
			group: entry.group,
			possibleScopes: entry.possibleScopes,
			batchable: entry.batchable,
		}]),
	);
	assert.deepEqual(actual, expected);
});

test("all runtime input schemas match the pre-migration Pi contract fixture", () => {
	for (const operation of HOPPER_OPERATIONS) {
		assert.deepEqual(
			schemaDigest(operation.inputSchema as unknown as JsonObject),
			PR1_INPUT_SCHEMA_GOLDEN[operation.name],
			`${operation.name} input schema changed`,
		);
	}
});

test("output schema hashes and top-level fields match the PR 1 golden", () => {
	const expectedFields: Record<Pr1OperationName, string[]> = {
		gh_apply_graph: ["counts", "refs", "runtimeMessages", "overlaps"],
		gh_create_widget: ["items"],
		gh_edit_components: ["items"],
		gh_edit_group: ["items"],
		gh_edit_param: ["items"],
		gh_edit_script: ["items"],
		gh_edit_wire: ["items"],
		gh_get_canvas: ["document", "canvas", "selectedObjectIds"],
		gh_get_canvas_errors: ["errors", "overlaps"],
		gh_list_components: ["components", "offset", "limit", "total"],
		gh_mutate_widget: ["items"],
		gh_param_rhino: ["items"],
		rh_capture_view: ["artifact", "metadata"],
		rh_query_objects: ["objects", "total"],
		rh_run_script: ["items"],
		rh_view_control: ["message", "metadata"],
	};
	for (const operation of HOPPER_OPERATIONS) {
		const name = operation.name as Pr1OperationName;
		const schema = operation.outputSchema as unknown as {
			properties?: Record<string, unknown>;
		};
		assert.deepEqual(
			schemaDigest(operation.outputSchema as unknown as JsonObject),
			PR1_OPERATION_REGISTRY_GOLDEN[name].outputSchema,
			`${name} output schema changed`,
		);
		assert.deepEqual(Object.keys(schema.properties ?? {}), expectedFields[name]);
	}
});

test("hybrid operation scopes follow validated item content", () => {
	const registry = createOperationRegistry();
	const cases: Array<[string, JsonObject, "none" | "grasshopper"]> = [
		["gh_param_rhino", { items: [{ action: "get", targetId: "param" }] }, "none"],
		["gh_param_rhino", { items: [
			{ action: "get", targetId: "param" },
			{ action: "reference", targetId: "param", rhinoObjectIds: ["object"] },
		] }, "grasshopper"],
		["gh_edit_param", { items: [{ action: "listParams", targetId: "script" }] }, "none"],
		["gh_edit_param", { items: [
			{ action: "listParams", targetId: "script" },
			{ action: "removeInput", targetId: "script", name: "x" },
		] }, "grasshopper"],
		["gh_edit_script", { items: [{ action: "getCode", targetId: "script" }] }, "none"],
		["gh_edit_script", { items: [
			{ action: "getCode", targetId: "script" },
			{ action: "setCode", targetId: "script", code: "print(1)" },
		] }, "grasshopper"],
	];
	for (const [name, input, expected] of cases) {
		assert.equal(registry.resolve(name, input).scope, expected, name);
	}
});

test("registered read and mutation operations execute with a neutral mocked context", async () => {
	const registry = createOperationRegistry();
	const read = await registry.execute(
		registry.resolve("rh_query_objects", { layer: "Facade", limit: 1 }),
		context({
			query: async (request) => {
				assert.equal(request.type, "queryRhinoObjects");
				return {
					objects: [
						{ objectId: "a", name: "A", layer: "Facade", objectType: "curve" },
						{ objectId: "b", name: "B", layer: "Facade", objectType: "mesh" },
					],
				};
			},
		}),
	);
	assert.equal(read.outcome, "succeeded");
	assert.equal((read.data as { objects: unknown[] }).objects.length, 1);

	const mutation = await registry.execute(
		registry.resolve("gh_edit_wire", {
			items: [{
				action: "connect",
				fromComponent: "from",
				fromPort: "out",
				toComponent: "to",
				toPort: "in",
			}],
		}),
		context({
			execute: async (request) => {
				assert.equal(Array.isArray(request.actions), true);
				return { outcome: "succeeded", data: null, error: null };
			},
		}),
	);
	assert.equal(mutation.outcome, "succeeded");
	assert.equal((mutation.data as { items: unknown[] }).items.length, 1);
});
