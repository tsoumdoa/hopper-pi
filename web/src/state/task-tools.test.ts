import { expect, it } from "vitest";
import type { EventSnapshot } from "../../../src/protocol/browser-snapshot.js";
import { taskTools } from "./task-tools";

const events = (...payloads: unknown[]): EventSnapshot[] => payloads.map((payload, id) => ({ id, task_id: "task", kind: "progress", payload: JSON.stringify(payload) }));
it("joins legacy tool starts to a turn's results and keeps text with empty details", () => {
	const result = taskTools(events(
		{ type: "tool_progress", phase: "started", toolCallId: "call", toolName: "bash", args: { command: "ls" } },
		{ type: "messages", turnId: "turn", messages: [{ role: "toolResult", toolCallId: "call", toolName: "bash", content: [{ type: "text", text: "output" }], details: {} }] },
	));
	expect(result).toEqual([{ id: "turn:call", name: "bash", args: { command: "ls" }, status: "complete", detail: { content: [{ type: "text", text: "output" }], details: {} } }]);
});
it("keeps calls in different turns separate and handles partial and error results", () => {
	const result = taskTools(events(
		{ type: "assistant_message", turnId: "one", streaming: true, message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } }] } },
		{ type: "tool_progress", turnId: "one", phase: "updated", toolCallId: "call", event: { partialResult: "partial" } },
		{ type: "tool_progress", turnId: "two", phase: "finished", toolCallId: "call", event: { result: "failed", isError: true } },
	));
	expect(result.map(({ id, detail, status }) => ({ id, detail, status }))).toEqual([
		{ id: "one:call", detail: "partial", status: "running" },
		{ id: "two:call", detail: "failed", status: "error" },
	]);
});
it("ignores malformed message lists without crashing", () => {
	expect(taskTools(events({ type: "messages", messages: [null] }, { type: "messages", messages: "invalid" }))).toEqual([]);
});
