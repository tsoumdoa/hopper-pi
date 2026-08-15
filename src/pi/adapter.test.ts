import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import { defineHopperTool } from "../core/tool-contract.js";
import { toPiTool } from "./adapter.js";

test("Pi adapter preserves metadata and translates execution context", async () => {
	let received: Record<string, unknown> | undefined;
	const spec = defineHopperTool({
		name: "test_tool",
		label: "Test Tool",
		description: "Adapter test",
		parameters: Type.Object({ value: Type.String() }),
		async execute(toolCallId, params, signal, onUpdate, hostContext) {
			received = { toolCallId, params, signal, hostContext };
			onUpdate?.({ content: [{ type: "text", text: "halfway" }], details: {} });
			return { content: [{ type: "text", text: params.value }], details: { ok: true }, isError: false };
		},
	});
	const tool = toPiTool(spec);
	const controller = new AbortController();
	const updates: unknown[] = [];
	const hostContext = { model: { provider: "test", id: "vision", input: ["text", "image"] } };
	const result = await tool.execute(
		"call-1",
		{ value: "done" },
		controller.signal,
		(update) => updates.push(update),
		hostContext as any,
	);

	assert.equal(tool.label, spec.title);
	assert.equal(tool.parameters, spec.inputSchema);
	assert.deepEqual(received, {
		toolCallId: "call-1",
		params: { value: "done" },
		signal: controller.signal,
		hostContext,
	});
	assert.equal(updates.length, 1);
	assert.deepEqual(result, {
		content: [{ type: "text", text: "done" }],
		details: { ok: true },
		isError: false,
	});
});
