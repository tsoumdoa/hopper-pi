import { expect, it } from "vitest";
import { readHistorySnapshot, type EventSnapshot } from "../../../src/protocol/browser-snapshot.js";
import { taskTools } from "./task-tools";
import { TaskJournal } from "../../../src/host/shared/journal.js";

const events = (...payloads: unknown[]): EventSnapshot[] => payloads.map((payload, id) => ({ id, task_id: "task", kind: "progress", payload: JSON.stringify(payload) }));
it.each([
	{ name: "gh_apply_graph", isError: false },
	{ name: "bash", isError: true },
])("preserves $name generation and execution through browser snapshots", ({ name, isError }) => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("chat", "Chat");
		const { taskId, turnId } = journal.accept({ ...conversation, requestId: "request", kind: "prompt", text: "Work", bindings: [], attachments: [] });
		journal.start(taskId, turnId);
		const agent = (event: unknown) => journal.publish(taskId, { type: "agent_event", turnId, event });
		const cards = () => taskTools(readHistorySnapshot(journal.browserSnapshot()).events);
		const expected = { id: `${turnId}:call`, name, status: "generating" };
		agent({ type: "message_start", message: { role: "assistant", content: [] } });
		agent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "call", toolName: name } });
		expect(cards()).toMatchObject([expected]);
		for (let i = 0; i < 10; i++) {
			agent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: " " } });
		}
		expect(cards()).toMatchObject([expected]);
		expect(journal.browserSnapshot().events).toHaveLength(2);
		const args = { input: "work" };
		const toolCall = { type: "toolCall", id: "call", name, arguments: args };
		agent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall } });
		expect(cards()).toMatchObject([{ ...expected, args }]);
		const assistant = { role: "assistant", content: [toolCall] };
		agent({ type: "message_end", message: assistant });
		expect(cards()).toMatchObject([{ ...expected, args }]);
		journal.publish(taskId, { type: "tool_progress", turnId, toolCallId: "call", toolName: name, phase: "started", event: { args } });
		expect(cards()).toMatchObject([{ ...expected, args, status: "running" }]);
		expect(journal.browserSnapshot().events).toHaveLength(2);
		const output = { content: [{ type: "text", text: "Output" }] };
		journal.publish(taskId, { type: "tool_progress", turnId, toolCallId: "call", toolName: name, phase: "completed", event: { result: output, isError } });
		const completed = { ...expected, args, status: isError ? "error" : "complete", detail: output };
		expect(cards()).toMatchObject([completed]);
		journal.publish(taskId, { type: "messages", turnId, messages: [assistant, { role: "toolResult", toolCallId: "call", toolName: name, ...output, isError }] });
		expect(cards()).toMatchObject([completed]);
		expect(journal.browserSnapshot().events).toHaveLength(1);
	} finally { journal.close(); }
});
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
