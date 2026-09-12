import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MockBackend } from "./ui-mock-backend.mjs";
import { TaskThread } from "../web/src/components/task-thread";
import { parseSharedServerMessage, validateSharedSnapshot } from "../src/protocol/browser-messages.js";
import { TooltipProvider } from "../web/src/components/ui/tooltip";

const backends: MockBackend[] = [];
function fixture(scenario = "empty") {
	const backend = new MockBackend(scenario, (message: unknown) => {
		expect(parseSharedServerMessage(JSON.stringify(message))).toBeDefined();
	});
	validateSharedSnapshot(backend.browserSnapshot());
	backends.push(backend);
	const { conversationId } = backend.command({ type: "create_conversation", title: "Test" });
	return { backend, conversationId };
}
function submit(backend: MockBackend, conversationId: string, text = "Test message") {
	return backend.command({ type: "submit", conversationId, sessionId: `${conversationId}-session`, kind: "prompt", text, bindings: [], attachments: [] });
}
afterEach(() => { backends.splice(0).forEach(backend => backend.dispose()); vi.useRealTimers(); });
describe("mock backend browser contract", () => {
	it.each(["running", "question", "failed", "empty", "images"])("validates the %s seed and every emitted progress snapshot", async scenario => {
		vi.useFakeTimers();
		const { backend, conversationId } = fixture(scenario);
		const snapshot = validateSharedSnapshot(backend.browserSnapshot());
		for (const question of snapshot.questions) {
			expect(snapshot.turns.some(turn => turn.id === question.turn_id && turn.task_id === question.task_id)).toBe(true);
		}
		if (scenario === "running") backend.command({ type: "cancel", conversationId, taskId: "t3" });
		if (scenario === "question") backend.command({ type: "answer", conversationId, questionId: "q2", answer: "1.2 m" });
		if (scenario === "failed") backend.command({ type: "recover", conversationId, taskId: "t5", acknowledgement: "Inspected" });
		if (scenario === "empty" || scenario === "images") submit(backend, conversationId);
		await vi.advanceTimersByTimeAsync(20_000);
		const settled = validateSharedSnapshot(backend.browserSnapshot());
		expect(settled.tasks.some(task => task.state === "running" || task.state === "queued")).toBe(false);
		expect(settled.events.every(event => Number.isSafeInteger(event.id))).toBe(true);
	});
	it("supports archive, restore and purge with sidebar metadata", () => {
		const { backend, conversationId } = fixture();
		backend.command({ type: "archive_conversation", conversationId });
		expect(backend.browserSnapshot().conversations[0].archived_at).toBeGreaterThan(0);
		backend.command({ type: "unarchive_conversation", conversationId });
		expect(backend.browserSnapshot().conversations[0].archived_at).toBeNull();
		backend.command({ type: "archive_conversation", conversationId });
		backend.command({ type: "purge_archived_conversations", conversationIds: [conversationId], before: null });
		expect(backend.browserSnapshot().conversations).toEqual([]);
	});
	it("does not restart or complete cancelled tasks", async () => {
		vi.useFakeTimers();
		const { backend, conversationId } = fixture();
		const first = submit(backend, conversationId);
		backend.command({ type: "cancel", conversationId, taskId: first.taskId });
		await vi.advanceTimersByTimeAsync(20000);
		expect(backend.task(first.taskId).state).toBe("cancelled");
		const second = submit(backend, conversationId);
		await vi.advanceTimersByTimeAsync(600);
		backend.command({ type: "cancel", conversationId, taskId: second.taskId });
		await vi.advanceTimersByTimeAsync(20000);
		expect(backend.task(second.taskId).state).toBe("cancelled");
	});
	it("serializes immediately submitted tasks", async () => {
		vi.useFakeTimers();
		const { backend, conversationId } = fixture();
		submit(backend, conversationId, "One"); submit(backend, conversationId, "Two");
		await vi.advanceTimersByTimeAsync(600);
		expect(backend.snapshot.tasks.filter(task => task.state === "running")).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(20000);
		expect(backend.snapshot.tasks.every(task => task.state === "completed")).toBe(true);
	});
	it("runs the seeded queued follow-up after cancelling the seeded running task", async () => {
		vi.useFakeTimers();
		const { backend, conversationId } = fixture("running");
		const queued = backend.snapshot.tasks.find(task => task.state === "queued");
		expect(queued).toBeDefined();
		backend.command({ type: "cancel", conversationId, taskId: "t3" });
		await vi.advanceTimersByTimeAsync(20_000);
		expect(backend.task(queued.id).state).toBe("completed");
	});
	it("projects streaming messages with stable IDs and supplies current provider methods", () => {
		const { backend, conversationId } = fixture("running");
		const snapshot = backend.browserSnapshot();
		const event = snapshot.events.map(row => JSON.parse(row.payload)).find(payload => payload.type === "assistant_message");
		expect(event.message.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("inspecting both models") })]));
		const html = renderToStaticMarkup(createElement(TooltipProvider, { children: createElement(TaskThread, { snapshot, tasks: snapshot.tasks, connected: true, conversationId, labelFor: () => "Facade", commands: { recoveryEnabled: true, answer: () => true, recover: () => true }, onSuggestion: () => {} }) }));
		expect(html).toContain("inspecting both models");
		expect(snapshot.conversations[0].live_state).toBe("running");
		expect(snapshot.history.conversationId).toBe(conversationId);
		expect(snapshot.runtime.providers[0].authMethods[0].type).toBe("api_key");
		expect(backend.browserSnapshot().events.map(row => JSON.parse(row.payload)).find(payload => payload.type === "assistant_message").messageId).toBe(event.messageId);
	});
	it("answers on a continuation turn and clears recovery indicators without rewriting uncertain work", async () => {
		vi.useFakeTimers();
		const { backend, conversationId } = fixture("question");
		backend.command({ type: "answer", conversationId, questionId: "q2", answer: null });
		await vi.advanceTimersByTimeAsync(2000);
		const snapshot = backend.browserSnapshot();
		const question = snapshot.questions.find(row => row.id === "q2");
		expect(question.answer).toBe("null");
		expect(snapshot.turns.find(turn => turn.id === question.continuation_id)?.state).toBe("completed");
		expect(snapshot.events.some(row => JSON.parse(row.payload).turnId === question.continuation_id)).toBe(true);
		const failed = fixture("failed");
		expect(failed.backend.browserSnapshot().conversations[0].recovery_required).toBe(1);
		failed.backend.command({ type: "recover", conversationId: failed.conversationId, taskId: "t5", acknowledgement: "Inspected" });
		expect(failed.backend.browserSnapshot().conversations[0].recovery_required).toBe(0);
		expect(failed.backend.task("t5").state).toBe("uncertain");
	});

	it("preserves the explicit message document and filters views independently", () => {
		const { backend, conversationId } = fixture();
		const binding = backend.snapshot.targets[1].documents[0];
		backend.command({ type: "submit", conversationId, sessionId: `${conversationId}-session`, kind: "prompt", text: "Roof", bindings: [backend.snapshot.targets[0].documents[0], binding], messageTarget: binding, attachments: [] });
		const { conversationId: second } = backend.command({ type: "create_conversation", title: "Second" });
		expect(backend.browserSnapshot({ conversationId: second }).tasks).toHaveLength(0);
		const first = backend.browserSnapshot({ conversationId });
		expect(JSON.parse(first.tasks[0].payload).messageTarget).toEqual(binding);
		expect(JSON.parse(first.conversations.find(row => row.id === conversationId).last_message_target)).toEqual(binding);
	});
});
