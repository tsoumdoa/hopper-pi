import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { QuestionSuspensionBoundary, type SuspendedQuestion } from "./question-suspension.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const question: SuspendedQuestion = { questionId: "q1", taskId: "task1", turnId: "turn1", sessionId: "session1", toolCallId: "ask", question: "Which radius?" };

async function fixture(persist = vi.fn(async (_question: SuspendedQuestion) => {})) {
	const root = await mkdtemp(join(tmpdir(), "hopper-pi-suspension-"));
	directories.push(root);
	const services = await createAgentSessionServices({
		cwd: root, agentDir: join(root, "agent"),
		resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
	});
	let boundary: QuestionSuspensionBoundary;
	const edit = vi.fn(async () => ({ content: [{ type: "text" as const, text: "edited" }], details: {} }));
	const tools: ToolDefinition[] = [
		{ name: "edit_test", label: "Edit", description: "Test edit", parameters: Type.Object({}), execute: edit },
		{ name: "ask_user", label: "Question", description: "Ask", parameters: Type.Object({}), execute: async () => boundary.suspend(question) },
	];
	const manager = SessionManager.create(root, join(root, "sessions"));
	const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, noTools: "builtin", customTools: tools });
	boundary = new QuestionSuspensionBoundary(session.agent, persist);
	const stream = vi.fn<typeof session.agent.streamFunction>((model) => {
		const content: AssistantMessage["content"] = stream.mock.calls.length === 1
			? ["before", "ask", "after"].map(id => ({ type: "toolCall", id, name: id === "ask" ? "ask_user" : "edit_test", arguments: {} }))
			: [{ type: "text", text: "Continued with the user's answer." }];
		const message: AssistantMessage = {
			role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
			stopReason: stream.mock.calls.length === 1 ? "toolUse" : "stop", timestamp: Date.now(),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
		const events = createAssistantMessageEventStream();
		events.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
		return events;
	});
	session.agent.streamFunction = stream;
	return { session, manager, boundary, persist, edit, stream };
}

it("stops the shipped SDK after a persisted question, records skipped siblings, and retains history in a fresh turn", async () => {
	const { session, manager, boundary, persist, edit, stream } = await fixture();
	try {
		// Use the real agent and AgentSession persistence subscriber, with only the provider stream injected.
		await session.agent.prompt("Edit and ask me for the radius");
		expect(stream).toHaveBeenCalledTimes(1);
		expect(edit).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledExactlyOnceWith(question);
		const results = session.messages.filter(message => message.role === "toolResult");
		expect(results.map(result => result.toolCallId)).toEqual(["before", "ask", "after"]);
		expect(results[1]?.details).toEqual({ status: "awaiting_user", question });
		expect(results[2]?.isError).toBe(true);
		expect(results[2]?.content).toEqual([{ type: "text", text: "Not executed: this turn is suspended for a user question." }]);
		boundary.dispose();
		const answer = JSON.stringify({ questionId: "q1", previousTurnId: "turn1", turnId: "turn2", question: question.question, answer: "5 metres" });
		await session.agent.prompt(answer);
		expect(stream).toHaveBeenCalledTimes(2);
		expect(edit).toHaveBeenCalledTimes(1);
		const restored = SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages;
		expect(restored.filter(message => message.role === "toolResult" && message.toolCallId === "ask")).toHaveLength(1);
		expect(restored.filter(message => message.role === "toolResult" && message.toolCallId === "ask")[0]).toMatchObject({ details: { status: "awaiting_user" } });
		expect(restored.filter(message => message.role === "user" && JSON.stringify(message).includes("5 metres"))).toHaveLength(1);
	} finally { session.dispose(); }
});

it("fails closed when question persistence fails", async () => {
	const { session, boundary, edit, stream } = await fixture(vi.fn(async () => { throw new Error("disk unavailable"); }));
	try {
		await session.agent.prompt("Edit and ask");
		expect(stream).toHaveBeenCalledTimes(1);
		expect(edit).toHaveBeenCalledTimes(1);
		expect(session.messages.filter(message => message.role === "toolResult")).toHaveLength(3);
		expect(session.messages.find(message => message.role === "toolResult" && message.toolCallId === "ask")).toMatchObject({ isError: true });
		boundary.dispose();
	} finally { session.dispose(); }
});

it("waits for question persistence and stops before draining queued steering or follow-ups", async () => {
	let entered!: () => void;
	let commit!: () => void;
	const persistenceEntered = new Promise<void>(resolve => { entered = resolve; });
	const persistenceCommit = new Promise<void>(resolve => { commit = resolve; });
	const { session, boundary, edit, stream } = await fixture(vi.fn(async () => {
		entered();
		await persistenceCommit;
	}));
	try {
		const running = session.agent.prompt("Edit and ask");
		await persistenceEntered;
		expect(edit).toHaveBeenCalledTimes(1);
		expect(() => boundary.dispose()).toThrow("while Pi is running");
		session.agent.steer({ role: "user", content: "queued steering", timestamp: Date.now() });
		session.agent.followUp({ role: "user", content: "queued follow-up", timestamp: Date.now() });
		commit();
		await running;
		expect(stream).toHaveBeenCalledTimes(1);
		expect(edit).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(session.messages)).not.toContain("queued steering");
		expect(JSON.stringify(session.messages)).not.toContain("queued follow-up");
		// The future scheduler must journal commands; Pi's queues are not durable admission.
		expect(session.agent.hasQueuedMessages()).toBe(true);
		session.agent.clearAllQueues();
		boundary.dispose();
	} finally { session.dispose(); }
});
