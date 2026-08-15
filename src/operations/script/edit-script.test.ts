import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "vitest";
import type {
	ExecuteActionsResponse,
	JsonObject,
} from "../../core/contracts.js";
import type { OperationContext } from "../../core/operations.js";
import {
	classifyGhEditScript,
	GhEditScriptInputSchema,
	ghEditScriptOperation,
	prepareGhEditScriptMutation,
	summarizeGhEditScriptInput,
} from "./edit-script.js";

type ContextOverrides = {
	query?: (request: JsonObject) => Promise<JsonObject>;
	execute?: (request: JsonObject) => Promise<ExecuteActionsResponse>;
};

function context(overrides: ContextOverrides = {}): OperationContext {
	return {
		signal: new AbortController().signal,
		requestId: "req_test",
		session: null,
		backend: {
			async query(request) {
				return await (overrides.query?.(request) ?? Promise.resolve({ code: "" })) as never;
			},
			async executeActions(request) {
				return await (overrides.execute?.(request) ?? Promise.resolve({
					outcome: "succeeded",
					data: null,
					error: null,
				}));
			},
		},
		artifacts: {} as never,
		reportProgress() {},
		now: () => new Date(0),
	};
}

test("keeps the frozen gh_edit_script input schema byte-for-byte", () => {
	const json = JSON.stringify(GhEditScriptInputSchema);
	assert.equal(Buffer.byteLength(json, "utf8"), 10938);
	assert.equal(
		createHash("sha256").update(json, "utf8").digest("hex"),
		"d4a59d9ec1272f68efaf151f61d287ee0fd2164046873cc191fc412011a7d215",
	);
});

test("classifies both read actions as none and any mutation as grasshopper", () => {
	assert.equal(classifyGhEditScript({ items: [
		{ action: "getCode", targetId: "one" },
		{ action: "getCodeParts", targetId: "two" },
	] }), "none");
	assert.equal(classifyGhEditScript({ items: [
		{ action: "getCode", targetId: "one" },
		{ action: "setCode", targetId: "two", code: "a = 1" },
	] }), "grasshopper");
});

test("summarizes source and replacements without leaking forbidden text or keys", () => {
	const secretCode = "api_secret = input_value\nresult = api_secret";
	const secretReplacement = "result = private_value";
	const secretHelper = "private double Hidden(double x) => x;";
	const summary = summarizeGhEditScriptInput({ items: [
		{ action: "create", x: 20, y: 20, language: "python", code: secretCode },
		{
			action: "setCode",
			targetId: "target-a",
			scriptParts: {
				references: ["Private.Assembly"],
				runScript: "private void RunScript(double x, ref object A) { A = x; }",
				helpers: secretHelper,
			},
		},
		{
			action: "patchCode",
			targetId: "target-b",
			patches: [{ op: "replace", startLine: 1, endLine: 1, lines: [secretReplacement] }],
		},
	] });
	const json = JSON.stringify(summary);

	for (const secret of [secretCode, "api_secret", secretReplacement, secretHelper, "Private.Assembly"]) {
		assert.equal(json.includes(secret), false, `summary leaked ${secret}`);
	}
	for (const forbiddenKey of ["code", "patches", "scriptParts", "helpers", "references", "replacement"]) {
		assert.equal(new RegExp(`"${forbiddenKey}"\\s*:`).test(json), false);
	}
	assert.equal(json.includes(createHash("sha256").update(secretCode).digest("hex")), true);
});

describe("prepareGhEditScriptMutation", () => {
	test("rejects reads from a batch", async () => {
		await assert.rejects(
			prepareGhEditScriptMutation({ items: [{ action: "getCode", targetId: "a" }] }, context()),
			(error: unknown) => (
				typeof error === "object"
				&& error !== null
				&& "hopperError" in error
				&& (error as { hopperError: { code: string } }).hopperError.code === "operation_not_batchable"
			),
		);
	});

	test("resolves and validates a patch before preparing one command action", async () => {
		const prepared = await prepareGhEditScriptMutation({ items: [{
			action: "patchCode",
			targetId: "script-a",
			patches: [{ op: "replace", startLine: 2, endLine: 2, lines: ["value = 2"] }],
		}] }, context({ query: async () => ({ code: "value = 1\nresult = value" }) }));

		assert.equal(prepared.scope, "grasshopper");
		assert.equal(prepared.actions.length, 1);
		assert.deepEqual(prepared.actions[0], {
			kind: "command",
			command: {
				action: "setScriptCode",
				params: {
					targetId: "script-a",
					code: "value = 1\nvalue = 2",
					inputs: undefined,
					outputs: undefined,
				},
			},
		});
	});

	test("validates create items declared as C# even when source detection does not match", async () => {
		await assert.rejects(
			prepareGhEditScriptMutation({ items: [{
				action: "create",
				x: 20,
				y: 20,
				language: "csharp",
				code: "this is not a Grasshopper C# script",
			}] }, context()),
			/C# script validation failed/,
		);
	});

	test("does not C# validate create items declared as Python", async () => {
		const source = "public class Script_Instance : GH_ScriptInstance {";
		const prepared = await prepareGhEditScriptMutation({ items: [{
			action: "create",
			x: 20,
			y: 20,
			language: "python",
			code: source,
		}] }, context());

		const command = prepared.actions[0]?.command as JsonObject;
		assert.equal((command.params as JsonObject).code, source);
	});
});

test("executes mixed reads and mutations in original order", async () => {
	const events: string[] = [];
	const operationContext = context({
		query: async (request) => {
			const queriedTarget = typeof request.targetId === "string" ? request.targetId : "missing";
			events.push(`query:${queriedTarget}`);
			return { code: "value = 1" };
		},
		execute: async (request) => {
			const actions = request.actions as JsonObject[];
			const command = actions[0].command as JsonObject;
			events.push(`mutation:${command.action}`);
			return { outcome: "succeeded", data: { jobId: "job-1" }, error: null };
		},
	});
	const result = await ghEditScriptOperation.execute({ items: [
		{ action: "getCode", targetId: "first" },
		{ action: "create", x: 20, y: 20, language: "python", code: "a = 1" },
		{ action: "getCode", targetId: "last" },
	] }, operationContext);

	assert.deepEqual(events, ["query:first", "mutation:createScriptNode", "query:last"]);
	assert.equal(result.outcome, "succeeded");
	assert.deepEqual(result.data?.items.map((item) => [item.index, item.action, item.outcome]), [
		[0, "getCode", "succeeded"],
		[1, "create", "succeeded"],
		[2, "getCode", "succeeded"],
	]);
});

test("submits mutation-only calls as one prepared backend request", async () => {
	const requests: JsonObject[] = [];
	const result = await ghEditScriptOperation.execute({ items: [
		{ action: "create", x: 20, y: 20, language: "python", code: "a = 1" },
		{ action: "setCode", targetId: "script", code: "a = 2" },
	] }, context({
		execute: async (request) => {
			requests.push(request);
			return {
				outcome: "unknown",
				data: { submittedJobIds: ["job-1", "job-2"] },
				error: { code: "outcome_unknown", message: "Jobs were queued.", retryable: false },
			};
		},
	}));

	assert.equal(requests.length, 1);
	assert.equal((requests[0]?.actions as JsonObject[]).length, 2);
	assert.equal(result.outcome, "unknown");
});

test("returns structured per-item failures without losing successful results", async () => {
	let queryCount = 0;
	const result = await ghEditScriptOperation.execute({ items: [
		{ action: "getCode", targetId: "good" },
		{ action: "getCode", targetId: "bad" },
	] }, context({
		query: async () => {
			queryCount++;
			if (queryCount === 2) throw new Error("backend read failed");
			return { code: "a = 1" };
		},
	}));

	assert.equal(result.outcome, "partial");
	assert.equal(result.data?.items[0].outcome, "succeeded");
	assert.equal(result.data?.items[1].outcome, "failed");
	assert.equal(result.data?.items[1].error?.message, "backend read failed");
});
