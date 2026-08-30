import assert from "node:assert/strict";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, test, vi } from "vitest";
import {
	executeHopperDelegate,
	runDelegateTask,
	type DelegateExecutionContext,
} from "./hopper-delegate.js";

function assistantResponse(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function delegateContext(complete: (...args: any[]) => Promise<AssistantMessage>): DelegateExecutionContext {
	return {
		model: { provider: "openai", id: "test-model", api: "openai-responses" } as any,
		modelRegistry: { complete } as DelegateExecutionContext["modelRegistry"],
	};
}

afterEach(() => {
	vi.useRealTimers();
});

test("delegates use the parent model registry and cap generated tokens", async () => {
	let calledModel: unknown;
	let calledOptions: Record<string, unknown> | undefined;
	const complete = vi.fn(async (model, _context, options) => {
		calledModel = model;
		calledOptions = options;
		return assistantResponse("delegate result");
	});
	const ctx = delegateContext(complete);

	const result = await runDelegateTask(
		{ name: "geometry", prompt: "Plan geometry" },
		{ tasks: [], maxOutputChars: 1_000 },
		ctx,
	);

	assert.equal(result.ok, true);
	assert.equal(result.text, "delegate result");
	assert.equal(complete.mock.calls.length, 1);
	assert.equal(calledModel, ctx.model);
	assert.equal(calledOptions?.maxTokens, 500);
	assert.equal(calledOptions?.cacheRetention, "none");
});

test("delegate cancellation reaches every active request", async () => {
	const seenSignals: AbortSignal[] = [];
	const complete = vi.fn((_model, _context, options) => {
		seenSignals.push(options.signal);
		return new Promise<AssistantMessage>(() => {});
	});
	const controller = new AbortController();
	const pending = executeHopperDelegate(
		{
			tasks: [
				{ name: "geometry", prompt: "Plan geometry" },
				{ name: "validation", prompt: "Plan validation" },
				{ name: "layout", prompt: "Plan layout" },
				{ name: "script", prompt: "Plan script" },
			],
			maxConcurrency: 2,
		},
		delegateContext(complete),
		controller.signal,
	);

	await Promise.resolve();
	controller.abort();
	const result = await pending;

	assert.equal(seenSignals.length, 2);
	assert.equal(seenSignals.every((signal) => signal.aborted), true);
	assert.equal(result.results.every((item) => !item.ok && item.error === "delegate cancelled"), true);
});

test("delegate timeout aborts the parent-registry request and clears its timer", async () => {
	vi.useFakeTimers();
	let requestSignal: AbortSignal | undefined;
	const complete = vi.fn((_model, _context, options) => {
		requestSignal = options.signal;
		return new Promise<AssistantMessage>(() => {});
	});
	const pending = runDelegateTask(
		{ name: "layout", prompt: "Plan layout" },
		{ tasks: [], timeoutMs: 5_000 },
		delegateContext(complete),
	);

	await vi.advanceTimersByTimeAsync(5_000);
	const result = await pending;

	assert.equal(result.ok, false);
	assert.equal(result.error, "delegate timed out after 5000ms");
	assert.equal(requestSignal?.aborted, true);
	assert.equal(vi.getTimerCount(), 0);
});

test("delegate reports provider errors without claiming success", async () => {
	const response = assistantResponse("", "error");
	response.errorMessage = "provider failed";
	const result = await runDelegateTask(
		{ name: "review", prompt: "Review it" },
		{ tasks: [] },
		delegateContext(async () => response),
	);

	assert.equal(result.ok, false);
	assert.equal(result.error, "provider failed");
});
