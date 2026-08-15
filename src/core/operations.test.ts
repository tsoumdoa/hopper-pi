import assert from "node:assert/strict";
import { Type } from "@sinclair/typebox";
import { test } from "vitest";
import type { JsonObject, JsonValue, OperationResult } from "./contracts.js";
import { HopperCoreError } from "./errors.js";
import {
	defineOperation,
	OperationRegistry,
	type OperationContext,
} from "./operations.js";

const inputSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	mutate: Type.Optional(Type.Boolean()),
});
const outputSchema = Type.Object({ greeting: Type.String() });

function result(
	overrides: Partial<OperationResult<{ greeting: string }>> = {},
): OperationResult<{ greeting: string }> {
	return {
		outcome: "succeeded",
		message: "done",
		data: { greeting: "hello" },
		warnings: [],
		artifacts: [],
		error: null,
		...overrides,
	};
}

function operation(
	execute: () => Promise<OperationResult<{ greeting: string }>> = async () => result(),
) {
	return defineOperation({
		name: "example",
		version: 1,
		description: "Example operation",
		group: "gh-edit",
		possibleScopes: ["none", "grasshopper"] as const,
		inputSchema,
		outputSchema,
		classifyScope: (input) => input.mutate ? "grasshopper" : "none",
		execute,
		summarizeInput: (input) => ({ name: input.name, mutate: input.mutate ?? false }),
	});
}

function context(): OperationContext {
	return {
		signal: new AbortController().signal,
		requestId: "req_test",
		session: null,
		backend: {
			query: async <T extends JsonValue>() => null as T,
			executeActions: async () => ({ outcome: "succeeded", data: null, error: null }),
		},
		artifacts: {
			write: async () => ({
				artifactId: "artifact_1",
				kind: "diagnostic",
				path: "artifact.txt",
				mediaType: "text/plain",
				byteLength: 0,
				sha256: "0",
			}),
		},
		reportProgress: () => {},
		now: () => new Date(0),
	};
}

test("registry rejects duplicate names and exposes catalog and schemas", () => {
	const registry = new OperationRegistry();
	const registered = operation();
	registry.register(registered);

	assert.equal(registry.get("example"), registered);
	assert.deepEqual(registry.list(), [{
		name: "example",
		version: 1,
		description: "Example operation",
		group: "gh-edit",
		possibleScopes: ["none", "grasshopper"],
		batchable: false,
	}]);
	assert.equal(registry.schema("example")?.inputSchema, inputSchema);
	assert.equal(registry.schema("missing"), undefined);

	assert.throws(
		() => registry.register(registered),
		(error: unknown) =>
			error instanceof HopperCoreError && error.hopperError.code === "invalid_command",
	);
});

test("resolve validates input and classifies its mutation scope", () => {
	const registry = new OperationRegistry();
	registry.register(operation());

	assert.equal(registry.resolve("example", { name: "hopper" }).scope, "none");
	assert.equal(
		registry.resolve("example", { name: "hopper", mutate: true }).scope,
		"grasshopper",
	);

	assert.throws(
		() => registry.resolve("missing", {}),
		(error: unknown) =>
			error instanceof HopperCoreError && error.hopperError.code === "operation_not_found",
	);
	assert.throws(
		() => registry.resolve("example", { name: "" }),
		(error: unknown) => {
			if (!(error instanceof HopperCoreError)) return false;
			assert.equal(error.hopperError.code, "invalid_input");
			const issues = error.hopperError.details?.issues as JsonValue[];
			assert.equal((issues[0] as { path: string }).path, "/name");
			return true;
		},
	);
});

test("execute contains thrown failures as structured operation results", async () => {
	const registry = new OperationRegistry();
	registry.register(operation(async () => {
		throw new Error("backend broke");
	}));

	const response = await registry.execute(
		registry.resolve("example", { name: "hopper" }),
		context(),
	);
	assert.equal(response.outcome, "failed");
	assert.equal(response.error?.code, "operation_failed");
	assert.equal(response.message, "backend broke");
});

test("execute preserves explicit unknown and partial mutation outcomes", async () => {
	for (const [code, expectedOutcome] of [
		["outcome_unknown", "unknown"],
		["partial_mutation", "partial"],
	] as const) {
		const registry = new OperationRegistry();
		registry.register(operation(async () => {
			throw new HopperCoreError({
				code,
				message: `${code} happened`,
				retryable: code === "outcome_unknown",
			});
		}));
		const response = await registry.execute(
			registry.resolve("example", { name: "hopper" }),
			context(),
		);
		assert.equal(response.outcome, expectedOutcome);
		assert.equal(response.error?.code, code);
		assert.equal(response.data, null);
	}
});

test("execute contains invalid result invariants and output data", async () => {
	const cases: Array<OperationResult<{ greeting: string }>> = [
		result({
			error: { code: "operation_failed", message: "contradiction", retryable: false },
		}),
		result({ outcome: "failed", error: null }),
		result({ data: { greeting: 42 as unknown as string } }),
		result({ data: { greeting: undefined as unknown as string } }),
		result({ outcome: "in_progress" }),
		result({
			outcome: "failed",
			error: {
				code: "not_a_hopper_code" as never,
				message: "bad code",
				retryable: false,
			},
		}),
		result({
			warnings: [{ code: 42 as unknown as string, message: "bad warning" }],
		}),
		result({
			warnings: [{
				code: "bad_details",
				message: "bad warning details",
				details: new Date(0) as unknown as JsonObject,
			}],
		}),
		result({
			artifacts: [{
				artifactId: "artifact_1",
				kind: "viewport_capture",
				path: "capture.png",
				mediaType: "image/png",
				byteLength: -1,
				sha256: "hash",
			}],
		}),
	];

	for (const invalid of cases) {
		const registry = new OperationRegistry();
		registry.register(operation(async () => invalid));
		const response = await registry.execute(
			registry.resolve("example", { name: "hopper" }),
			context(),
		);
		assert.equal(response.outcome, "failed");
		assert.equal(response.error?.code, "internal_error");
	}
});

test("catalog reports prepareMutation operations as batchable", () => {
	const registry = new OperationRegistry();
	const batchable = {
		...operation(),
		prepareMutation: async () => ({
			scope: "grasshopper" as const,
			actions: [],
			finish: () => result(),
		}),
	};
	registry.register(batchable);
	assert.equal(registry.list()[0]?.batchable, true);
});
