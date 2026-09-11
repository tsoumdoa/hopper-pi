import { expect, it, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedTaskService } from "./task-service.js";
import { SharedBackend } from "./backend.js";
import type { HostRuntime } from "../pi-runtime.js";

it("coalesces streamed updates before reading history and cancels pending publication on disposal", () => {
	vi.useFakeTimers();
	const s = setup();
	const snapshot = vi.spyOn(s.backend, "snapshot");
	try {
		const receive = vi.fn();
		s.backend.subscribe(receive);
		for (let i = 0; i < 1000; i++) s.backend.publish();
		expect(snapshot).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(receive).toHaveBeenCalledTimes(1);
		expect(receive.mock.calls[0]![0]).toMatchObject({ type: "shared_snapshot" });
		s.backend.publish();
		s.backend.dispose();
		vi.advanceTimersByTime(100);
		expect(snapshot).toHaveBeenCalledTimes(1);
	} finally {
		s.backend.dispose();
		s.journal.close();
		vi.useRealTimers();
	}
});

function setup() {
	const journal = new TaskJournal(":memory:");
	const registry = new SharedRegistry(journal);
	const createDriver = vi.fn(() => {
		throw new Error("No model in admission tests");
	});
	const tasks = new SharedTaskService(journal, {
		resolveBinding: (binding) => registry.resolveBinding(binding),
		validateBinding: () => {},
		createDriver,
	});
	const admin = {
		bus: { subscribe: () => () => {} },
		snapshot: () => ({}),
		setThinkingLevel: vi.fn(),
		logout: vi.fn(async () => {}),
		ui: { replayPending: () => {} },
	} as unknown as HostRuntime;
	const backend = new SharedBackend(tasks, registry, admin, async () => {}, {
		recover: async () => {},
	});
	const conversation = journal.createConversation("conversation", "Test");
	const command = {
		type: "submit" as const,
		requestId: "submit",
		conversationId: conversation.conversationId,
		sessionId: conversation.sessionId,
		kind: "prompt" as const,
		text: "Create a document",
		bindings: [],
		attachments: [],
	};
	return {
		journal,
		admin,
		registry,
		tasks,
		backend,
		command,
		createDriver,
	};
}

it("reuses bounded history on idle refresh and sends only status until the journal or page changes", async () => {
	vi.useFakeTimers();
	const s = setup();
	try {
		const read = vi.spyOn(s.journal, "browserSnapshot");
		const full = vi.spyOn(s.journal, "snapshot");
		const receive = vi.fn();
		s.backend.subscribe(receive);
		s.backend.publish(); vi.advanceTimersByTime(50);
		expect(receive.mock.calls.at(-1)![0].type).toBe("shared_snapshot");
		for (let i = 0; i < 30; i++) { s.backend.publish(); vi.advanceTimersByTime(50); }
		expect(read).toHaveBeenCalledTimes(1);
		expect(full).not.toHaveBeenCalled();
		expect(receive.mock.calls.at(-1)![0].type).toBe("shared_status");
		expect(receive.mock.calls.at(-1)![0]).not.toHaveProperty("snapshot");
		await s.backend.command({ type: "snapshot", conversationId: s.command.conversationId, before: 10 });
		vi.advanceTimersByTime(50);
		expect(receive.mock.calls.at(-1)![0].type).toBe("shared_snapshot");
		expect(read).toHaveBeenCalledTimes(2);
	} finally { s.backend.dispose(); s.journal.close(); vi.useRealTimers(); }
});
it("omits fixture-only conversations from the browser while preserving export and event cursor", () => {
	const s = setup();
	try {
		const fixture = s.journal.createConversation("fixture-conversation", "Fixture");
		const accepted = s.journal.accept({
			...fixture,
			requestId: "fixture-task",
			kind: "prompt",
			text: "Internal fixture",
			bindings: [],
			attachments: [],
			diagnosticFixture: "shared-host-native-smoke",
		});
		const snapshot = s.backend.snapshot();
		expect(snapshot.conversations.some((row) => row.id === fixture.conversationId)).toBe(false);
		expect(snapshot.tasks).toHaveLength(0);
		expect(snapshot.eventCursor).toBe(accepted.eventId);
		expect(s.backend.exportConversation(fixture.conversationId).tasks.map((row) => row.id)).toEqual([accepted.taskId]);
	} finally {
		s.journal.close();
	}
});
it("rejects cross-conversation cancellation and closes all new admission on stop", async () => {
	const s = setup();
	const { type, ...input } = s.command;
	const receipt = s.journal.accept(input);
	await expect(
		s.backend.command({
			type: "cancel",
			requestId: "cancel",
			taskId: receipt.taskId,
			conversationId: "other",
		}),
	).rejects.toThrow("conversation");
	s.backend.stopAdmission();
	await expect(s.backend.command(s.command)).rejects.toThrow("stopping");
	expect(s.createDriver).not.toHaveBeenCalled();
	s.backend.dispose();
	s.journal.close();
});

it("does not let a pending stop command from the previous host stop its replacement", async () => {
	const s = setup();
	await expect(
		s.backend.command({
			type: "stop_host",
			requestId: "old-stop",
			hostEpoch: "previous-host",
		}),
	).rejects.toThrow("Host restarted");
	expect(s.backend.snapshot().hostEpoch).toBe("test-host");
	expect(
		await s.backend.command({
			type: "create_conversation",
			requestId: "still-running",
			title: "New work",
		}),
	).toHaveProperty("conversationId");
	s.backend.dispose();
	s.journal.close();
});
it("normal UI thinking and logout settings reach the task host admin", async () => {
	const s = setup();
	await s.backend.command({ type: "set_thinking", level: "high" });
	await s.backend.command({ type: "logout", provider: "provider" });
	expect(s.admin.setThinkingLevel).toHaveBeenCalledWith("high");
	expect(s.admin.logout).toHaveBeenCalledWith("provider");
	s.backend.dispose();
	s.journal.close();
});

it("exports only the selected durable conversation and rejects missing selections", () => {
	const s = setup();
	s.journal.createConversation("other", "Private other conversation");
	const exported = s.backend.exportConversation(s.command.conversationId);
	expect(exported.format).toBe("hopper-conversation-debug");
	expect(exported.conversation.id).toBe(s.command.conversationId);
	expect(exported.sessions).toHaveLength(1);
	expect(JSON.stringify(exported)).not.toContain("Private other conversation");
	expect(() => s.backend.exportConversation(null)).toThrow("Select a conversation");
	expect(() => s.backend.exportConversation("missing")).toThrow("Select a conversation");
	s.backend.dispose();
	s.journal.close();
});

it("admits ordinary document requests without a separate authorization and deduplicates submissions", async () => {
 const s = setup();
 const first = await s.backend.command(s.command);
 expect(await s.backend.command(s.command)).toEqual(first);
 expect(s.createDriver).toHaveBeenCalledTimes(1);
 expect(s.journal.snapshot().records.some(row => row.kind === "grant")).toBe(false);
 await s.tasks.stop(); s.backend.dispose(); s.journal.close();
});
