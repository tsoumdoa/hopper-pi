import assert from "node:assert/strict";
import type { ServerContext } from "@modelcontextprotocol/server";
import { test } from "vitest";
import { Type } from "typebox";
import { defineHopperTool } from "../core/tool-contract.js";
import { createMcpToolHandler, toMcpResult } from "./tool-adapter.js";

function fakeContext(options: {
	id?: string | number;
	progressToken?: string | number;
	signal?: AbortSignal;
	notifications?: unknown[];
} = {}): ServerContext {
	const notifications = options.notifications ?? [];
	return {
		mcpReq: {
			id: options.id ?? "call-1",
			method: "tools/call",
			_meta: options.progressToken === undefined
				? undefined
				: { progressToken: options.progressToken },
			requestState: () => undefined,
			signal: options.signal ?? new AbortController().signal,
			send: async () => ({}),
			notify: async (notification: unknown) => {
				notifications.push(notification);
			},
			log: async () => {},
			elicitInput: async () => ({ action: "cancel" }),
			requestSampling: async () => ({ model: "test", role: "assistant", content: { type: "text", text: "" } }),
		},
	} as unknown as ServerContext;
}

test("adapter maps successful content and details to MCP", async () => {
	const controller = new AbortController();
	const notifications: unknown[] = [];
	let received: Record<string, unknown> | undefined;
	const spec = defineHopperTool({
		name: "test_success",
		label: "Test Success",
		description: "test",
		parameters: Type.Object({ value: Type.String() }),
		prepareArguments(args) {
			return { value: String((args as { value: unknown }).value).trim() };
		},
		async execute(toolCallId, params, signal, onUpdate, hostContext) {
			received = { toolCallId, params, signal, hostContext };
			onUpdate?.({ content: [{ type: "text", text: "Halfway" }], details: { step: 1 } });
			return {
				content: [
					{ type: "text", text: params.value },
					{ type: "image", data: "cG5n", mimeType: "image/png" },
				],
				details: { ok: true },
				isError: false,
			};
		},
	});

	const result = await createMcpToolHandler(spec)(
		{ value: " done " },
		fakeContext({ id: 42, progressToken: "progress-1", signal: controller.signal, notifications }),
	);

	assert.equal(received?.toolCallId, "42");
	assert.deepEqual(received?.params, { value: "done" });
	assert.equal(received?.signal, controller.signal);
	assert.deepEqual(result, {
		content: [
			{ type: "text", text: "done" },
			{ type: "image", data: "cG5n", mimeType: "image/png" },
		],
		structuredContent: { ok: true },
		isError: false,
	});
	assert.deepEqual(notifications, [{
		method: "notifications/progress",
		params: {
			progressToken: "progress-1",
			progress: 1,
			message: "Halfway",
		},
	}]);
});

test("adapter preserves core failure results", () => {
	assert.deepEqual(
		toMcpResult({
			content: [{ type: "text", text: "ERROR: backend unavailable" }],
			details: { code: "offline" },
			isError: true,
		}),
		{
			content: [{ type: "text", text: "ERROR: backend unavailable" }],
			structuredContent: { code: "offline" },
			isError: true,
		},
	);
});
