import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import { defineHopperTool, type HopperToolAnnotations } from "./tool-contract.js";
import { executeHopperTool, type TransactionPair } from "./execute-tool.js";
import { errorResult } from "./tool-error.js";

const readOnly: HopperToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

function transactions(events: string[]): TransactionPair {
	return {
		async begin() { events.push("begin"); },
		async commit() { events.push("commit"); },
		async cancel() { events.push("cancel"); },
	};
}

function spec(options: {
	annotations?: HopperToolAnnotations;
	run: () => Promise<any>;
}) {
	return defineHopperTool({
		name: "test_tool",
		label: "Test tool",
		description: "test",
		parameters: Type.Object({}),
		annotations: options.annotations,
		async execute() { return options.run(); },
	});
}

const ctx = { toolCallId: "call-1" };

test("read-only tools bypass per-call transactions", async () => {
	const events: string[] = [];
	const result = await executeHopperTool(
		spec({ annotations: readOnly, run: async () => ({ content: [], details: { ok: true } }) }),
		{},
		ctx,
		transactions(events),
	);
	assert.deepEqual(events, []);
	assert.deepEqual(result.details, { ok: true });
});

test("destructive success commits and tool errors cancel", async () => {
	const successEvents: string[] = [];
	await executeHopperTool(
		spec({ run: async () => ({ content: [], details: {} }) }),
		{},
		ctx,
		transactions(successEvents),
	);
	assert.deepEqual(successEvents, ["begin", "commit"]);

	const failureEvents: string[] = [];
	const failure = await executeHopperTool(
		spec({ run: async () => errorResult("backend_error", "backend failed") }),
		{},
		ctx,
		transactions(failureEvents),
	);
	assert.deepEqual(failureEvents, ["begin", "cancel"]);
	assert.equal(failure.isError, true);
});

test("throws and aborts cancel a started transaction", async () => {
	const thrownEvents: string[] = [];
	const thrown = await executeHopperTool(
		spec({ run: async () => { throw new Error("boom"); } }),
		{},
		ctx,
		transactions(thrownEvents),
	);
	assert.deepEqual(thrownEvents, ["begin", "cancel"]);
	assert.equal((thrown.details as any).error.code, "internal_error");

	const controller = new AbortController();
	const abortedEvents: string[] = [];
	const aborted = await executeHopperTool(
		spec({ run: async () => {
			controller.abort();
			return { content: [], details: {} };
		} }),
		{},
		{ toolCallId: "call-2", signal: controller.signal },
		transactions(abortedEvents),
	);
	assert.deepEqual(abortedEvents, ["begin", "cancel"]);
	assert.equal((aborted.details as any).error.code, "cancelled");
});

test("a partial begin failure still attempts to close both transactions", async () => {
	const events: string[] = [];
	const result = await executeHopperTool(
		spec({ run: async () => ({ content: [], details: {} }) }),
		{},
		ctx,
		{
			async begin() { events.push("begin"); throw new Error("second begin failed"); },
			async commit() { events.push("commit"); },
			async cancel() { events.push("cancel"); },
		},
	);
	assert.deepEqual(events, ["begin", "cancel"]);
	assert.equal(result.isError, true);
});

test("destructive calls are serialized around their transaction pairs", async () => {
	const events: string[] = [];
	let releaseFirst!: () => void;
	const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
	let calls = 0;
	const tool = spec({
		async run() {
			calls += 1;
			events.push(`run-${calls}`);
			if (calls === 1) await firstGate;
			return { content: [], details: {} };
		},
	});
	const tx: TransactionPair = {
		async begin() { events.push("begin"); },
		async commit() { events.push("commit"); },
		async cancel() { events.push("cancel"); },
	};

	const first = executeHopperTool(tool, {}, { toolCallId: "first" }, tx);
	const second = executeHopperTool(tool, {}, { toolCallId: "second" }, tx);
	await Promise.resolve();
	assert.deepEqual(events, ["begin"]);
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(events, ["begin", "run-1", "commit", "begin", "run-2", "commit"]);
});
