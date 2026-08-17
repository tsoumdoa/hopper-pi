import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "vitest";
import type {
	ExecuteActionsResponse,
	JsonObject,
} from "../core/contracts.js";
import type { OperationContext } from "../core/operations.js";
import {
	ApplyGraphInputSchema,
	ghApplyGraphOperation,
	prepareApplyGraphMutation,
	summarizeApplyGraphInput,
} from "./apply-graph.js";

function contextWithResponse(
	response: ExecuteActionsResponse,
	onExecute?: (request: JsonObject, signal?: AbortSignal) => void,
): OperationContext {
	const signal = new AbortController().signal;
	return {
		signal,
		requestId: "req_test",
		session: null,
		backend: {
			async query() {
				throw new Error("unexpected query");
			},
			async executeActions(request, passedSignal) {
				onExecute?.(request, passedSignal);
				return response;
			},
		},
		artifacts: {} as never,
		reportProgress() {},
		now: () => new Date(0),
	};
}

test("keeps the frozen gh_apply_graph input schema byte-for-byte", () => {
	const json = JSON.stringify(ApplyGraphInputSchema);
	assert.equal(Buffer.byteLength(json, "utf8"), 6296);
	assert.equal(
		createHash("sha256").update(json, "utf8").digest("hex"),
		"63e6e31d92cba9e75eb9242a2a3f59dda2b13b8c823b4e93bd07ba5788a144dc",
	);
});

test("wire endpoints use draft 2020-12 prefixItems tuples", () => {
	const properties = (ApplyGraphInputSchema as unknown as {
		properties: Record<string, any>;
	}).properties;
	const endpoints = properties.wires.items.properties;

	for (const end of ["from", "to"] as const) {
		assert.equal(endpoints[end].type, "array");
		assert.equal(endpoints[end].prefixItems.length, 2);
		assert.equal(endpoints[end].items, false);
		assert.equal(endpoints[end].minItems, 2);
		assert.equal(endpoints[end].maxItems, 2);
		assert.equal("additionalItems" in endpoints[end], false);
	}
});

test("summarizes counts and hashes script sources without retaining source text", () => {
	const pythonCode = "secret_token = input_value\nresult = secret_token * 2";
	const runScript = "private void RunScript(double x, ref object A) { A = x; }";
	const helpers = "private double SecretHelper(double x) => x * 2;";
	const summary = summarizeApplyGraphInput({
		components: [{ ref: "add", type: "Addition", x: 100, y: 100 }],
		widgets: [{ ref: "toggle", kind: "toggle", x: 100, y: 200, value: true }],
		scripts: [
			{ ref: "py", language: "python", x: 300, y: 100, code: pythonCode },
			{
				ref: "cs",
				language: "csharp",
				x: 500,
				y: 100,
				scriptParts: {
					references: ["Secret.Assembly"],
					runScript,
					helpers,
				},
			},
		],
		wires: [{ from: ["toggle", 0], to: ["add", "A"] }],
		groups: [{ name: "Graph", refs: ["add", "toggle", "py", "cs"] }],
	});

	assert.deepEqual(summary.counts, {
		components: 1,
		widgets: 1,
		scripts: 2,
		wires: 1,
		groups: 1,
	});
	assert.deepEqual(
		(summary.scripts as JsonObject[]).map((script) => [script.ref, script.language]),
		[["py", "python"], ["cs", "csharp"]],
	);
	const serialized = JSON.stringify(summary);
	for (const secret of [pythonCode, "secret_token", runScript, helpers, "Secret.Assembly"]) {
		assert.equal(serialized.includes(secret), false, `summary leaked ${secret}`);
	}
	assert.equal(
		serialized.includes(createHash("sha256").update(pythonCode).digest("hex")),
		true,
	);
});

describe("ghApplyGraphOperation", () => {
	test("classifies and prepares one applyGraph action", async () => {
		const input = {
			components: [{ ref: "a", type: "Addition", x: 100, y: 100 }],
		};
		const context = contextWithResponse({ outcome: "succeeded", data: null, error: null });
		const prepared = await prepareApplyGraphMutation(input, context);

		assert.equal(ghApplyGraphOperation.classifyScope(input), "grasshopper");
		assert.equal(prepared.scope, "grasshopper");
		assert.deepEqual(prepared.actions, [{ kind: "applyGraph", input }]);
	});

	test("executes through the backend and finishes a structured success", async () => {
		const input = {
			components: [{ ref: "a", type: "Addition", x: 100, y: 100 }],
		};
		const data = {
			counts: { components: 1, widgets: 0, scripts: 0, wires: 0, groups: 0 },
			refs: { a: "short-id" },
			runtimeMessages: [],
			overlaps: null,
		};
		let request: JsonObject | undefined;
		let passedSignal: AbortSignal | undefined;
		const context = contextWithResponse(
			{ outcome: "succeeded", data: {
				actions: [{ outcome: "succeeded", data }],
				canvasDigestAfter: "digest-after",
			}, error: null, canvasDigestAfter: "digest-after" },
			(value, signal) => {
				request = value;
				passedSignal = signal;
			},
		);

		const operationResult = await ghApplyGraphOperation.execute(input, context);

		assert.deepEqual(request, {
			scope: "grasshopper",
			actions: [{ kind: "applyGraph", input }],
		});
		assert.equal(passedSignal, context.signal);
		assert.deepEqual(operationResult, {
			outcome: "succeeded",
			message: "Applied the Grasshopper graph.",
			data,
			execution: { canvasDigestAfter: "digest-after" },
			warnings: [],
			artifacts: [],
			error: null,
		});
	});

	test("preserves structured backend failures", async () => {
		const error = {
			code: "operation_failed" as const,
			message: "Graph validation failed.",
			retryable: false,
			details: { path: "components[0]" },
		};
		const context = contextWithResponse({ outcome: "failed", data: null, error });

		const operationResult = await ghApplyGraphOperation.execute({}, context);

		assert.equal(operationResult.outcome, "failed");
		assert.equal(operationResult.data, null);
		assert.equal(operationResult.error, error);
		assert.equal(operationResult.message, error.message);
	});
});
