import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TaskJournal } from "./journal.js";

const submit = (journal: TaskJournal, conversation: { conversationId: string; sessionId: string }, requestId: string) =>
	journal.accept({ ...conversation, requestId, kind: "prompt", text: requestId, bindings: [], attachments: [] });

it("compacts a long live stream and tool output, then replaces it with final messages without losing durable evidence", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("chat", "Chat");
		const { taskId, turnId } = submit(journal, conversation, "request");
		journal.start(taskId, turnId);
		const agent = (event: unknown) => journal.publish(taskId, { type: "agent_event", turnId, event });
		agent({ type: "message_start", message: { role: "assistant", content: [] } });
		journal.publish(taskId, { type: "tool_progress", turnId, toolCallId: "call", toolName: "bash", phase: "started", event: { args: { command: "work" } } });
		for (let i = 0; i < 1000; i++) {
			agent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x" } });
			journal.publish(taskId, { type: "tool_progress", turnId, toolCallId: "call", toolName: "bash", phase: "updated", event: { partialResult: { content: [{ type: "text", text: `output-${i}` }] } } });
		}
		const live = journal.browserSnapshot();
		expect(live.events).toHaveLength(3);
		expect(JSON.parse(String(live.events[0].payload))).toMatchObject({ type: "assistant_message", streaming: true, message: { content: [{ type: "text", text: "x".repeat(1000) }] } });
		expect(JSON.stringify(live.events)).toContain("output-999");
		expect(JSON.stringify(live.events)).not.toContain("output-998");
		const messages = [{ role: "assistant", content: [{ type: "text", text: "Done" }] }];
		journal.publish(taskId, { type: "messages", turnId, messages });
		journal.settle(taskId, turnId, "completed");
		expect(journal.browserSnapshot().events).toHaveLength(1);
		expect(JSON.parse(String(journal.browserSnapshot().events[0].payload)).messages).toEqual(messages);
		expect(journal.snapshot().events.length).toBeGreaterThan(2000);
		expect(JSON.stringify(journal.snapshot().events)).toContain("output-998");
	} finally { journal.close(); }
});

it("preserves interrupted assistant messages and tool arguments without a final message list", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("chat", "Chat");
		const { taskId, turnId } = submit(journal, conversation, "request");
		journal.start(taskId, turnId);
		const agent = (event: unknown) => journal.publish(taskId, { type: "agent_event", turnId, event });
		agent({ type: "message_start", message: { role: "assistant", content: [] } });
		agent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Thinking" } });
		agent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Partial" } });
		agent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "call", name: "bash", arguments: { command: "work" } } } });
		journal.settle(taskId, turnId, "cancelled");
		const projected = journal.browserSnapshot().events;
		expect(projected).toHaveLength(1);
		expect(JSON.parse(String(projected[0].payload)).message.content).toEqual([
			{ type: "thinking", thinking: "Thinking" }, { type: "text", text: "Partial" },
			{ type: "toolCall", id: "call", name: "bash", arguments: { command: "work" } },
		]);
	} finally { journal.close(); }
});

it("pages completed roots, retains active tasks for controls, and excludes other conversations' content", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("chat", "Chat");
		const ids: string[] = [];
		for (let i = 0; i < 45; i++) {
			const { taskId, turnId } = submit(journal, conversation, `request-${i}`);
			journal.start(taskId, turnId);
			journal.publish(taskId, { type: "messages", turnId, messages: [{ text: `message-${i}` }] });
			journal.settle(taskId, turnId, "completed"); ids.push(taskId);
		}
		const active = submit(journal, conversation, "active");
		journal.start(active.taskId, active.turnId);
		const other = journal.createConversation("other", "Other");
		const hidden = submit(journal, other, "other-request");
		journal.publish(hidden.taskId, { type: "messages", turnId: hidden.turnId, messages: [{ text: "hidden-content" }] });
		const latest = journal.browserSnapshot({ conversationId: conversation.conversationId });
		expect(latest.history.hasOlder).toBe(true);
		expect(latest.history.pageTaskIds).toHaveLength(20);
		expect(latest.tasks.at(-1)!.id).toBe(active.taskId);
		expect(JSON.stringify(latest.events)).not.toContain("hidden-content");
		const older = journal.browserSnapshot({ conversationId: conversation.conversationId, before: Number(latest.history.oldestSequence) });
		expect(older.history.pageTaskIds).toHaveLength(20);
		expect(older.history.pageTaskIds.some(id => latest.history.pageTaskIds.includes(id))).toBe(false);
		expect(older.tasks.some(task => task.id === active.taskId)).toBe(true);
		expect(older.history.pageTaskIds).not.toContain(active.taskId);
		const first = journal.browserSnapshot({ conversationId: conversation.conversationId, before: Number(older.history.oldestSequence) });
		expect(first.history.hasOlder).toBe(false);
		expect(first.history.pageTaskIds).toEqual(ids.slice(0, 6));
		expect(journal.snapshot().tasks).toHaveLength(47);
	} finally { journal.close(); }
});

it("rebuilds the projection from an existing journal and keeps it consistent after reopening", () => {
	const directory = mkdtempSync(join(tmpdir(), "hopper-history-"));
	const path = join(directory, "journal.sqlite");
	let journal = new TaskJournal(path);
	try {
		const conversation = journal.createConversation("chat", "Chat");
		const { taskId, turnId } = submit(journal, conversation, "request");
		journal.publish(taskId, { type: "messages", turnId, messages: [{ text: "Saved" }] });
		const expected = journal.browserSnapshot();
		journal.close();
		const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
		const db = new DatabaseSync(path);
		db.exec("DROP TABLE browser_events; DROP TABLE browser_history_cursor;"); db.close();
		journal = new TaskJournal(path);
		expect(journal.browserSnapshot()).toEqual(expected);
		journal.close(); journal = new TaskJournal(path);
		expect(journal.browserSnapshot()).toEqual(expected);
	} finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("can select an older chat after more than 100 conversations in the host session", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const first = journal.createConversation("first", "First");
		for (let index = 0; index < 100; index++) journal.createConversation(`chat-${index}`, "Chat");
		const selected = journal.browserSnapshot({ conversationId: first.conversationId });
		expect(selected.history.conversationId).toBe(first.conversationId);
		expect(selected.sessions.some(row => row.id === first.sessionId)).toBe(true);
	} finally { journal.close(); }
});
