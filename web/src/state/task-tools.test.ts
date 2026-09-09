import { expect, it } from "vitest";
import { taskTools } from "./task-tools";
import { formatValue } from "../lib/utils";
const row = (payload: unknown) => ({ payload: JSON.stringify(payload) });
const progress = (phase: string, event: unknown) => row({ type: "tool_progress", turnId: "turn", phase, toolCallId: "call", toolName: "rh_run_script", event });
const args = { code: "return 42;" };
it("shows inputs and partial results before agent_end, and restores final output on reconnect", () => {
	const started = progress("started", { args });
	expect(taskTools([started])).toMatchObject([{ args, detail: args, status: "running" }]);
	const updated = progress("updated", { partialResult: { content: [{ type: "text", text: "Evaluating" }] } });
	expect(formatValue(taskTools([started, updated])[0]!.detail)).toBe("Evaluating");
	const done = progress("completed", { result: { content: [{ type: "text", text: "42" }], details: {} } });
	const replay = JSON.parse(JSON.stringify([started, updated, done]));
	expect(taskTools(replay)).toMatchObject([{ args, status: "complete" }]);
	expect(formatValue(taskTools(replay)[0]!.detail)).toBe("42");
});
it("recovers older live arguments from assistant messages without clearing output on status-only progress", () => {
	const events = [
		row({ type: "agent_event", turnId: "turn", event: { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "rh_run_script", arguments: args }] } } }),
		row({ type: "tool_progress", phase: "completed", toolCallId: "call", toolName: "rh_run_script" }),
	];
	expect(taskTools(events)).toMatchObject([{ args, detail: args, status: "complete" }]);
});
it("preserves saved textual errors when a tool also supplies empty details", () => {
	const events = [row({ type: "messages", turnId: "turn", messages: [
		{ role: "assistant", content: [{ type: "toolCall", id: "call", name: "rh_run_script", arguments: args }] },
		{ role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "Script failed" }], details: {}, isError: true },
	] })];
	expect(taskTools(events)).toMatchObject([{ args, status: "error" }]);
	expect(formatValue(taskTools(events)[0]!.detail)).toBe("Script failed");
});
it("keeps calls with reused provider IDs in separate turns", () => {
	const events = ["one", "two"].map((turnId) => row({ type: "tool_progress", turnId, phase: "started", toolCallId: "call", toolName: "read", event: { args: { path: turnId } } }));
	expect(taskTools(events)).toMatchObject([{ args: { path: "one" } }, { args: { path: "two" } }]);
});
