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

function setup(authorizeDocument = vi.fn(async () => {})) {
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
	const recoverLaunch = vi.fn(async () => ({ id: "launch" }));
	const backend = new SharedBackend(tasks, registry, admin, async () => {}, {
		authorizeDocument,
		installations: () => [],
		recover: async () => {},
		recoverLaunch,
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
		documentAction: {
			lifecycleInstanceId: "lifecycle",
			kind: "rhino" as const,
			action: "new" as const,
			modifiedPolicy: "refuse" as const,
		},
	};
	return {
		journal,
		admin,
		registry,
		tasks,
		backend,
		command,
		createDriver,
		authorizeDocument,
		recoverLaunch,
	};
}
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
it("holds model admission until the exact document grant commits and deduplicates retries", async () => {
	let finish!: () => void;
	const s = setup(
		vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		),
	);
	const pending = s.backend.command(s.command);
	const concurrentRetry = s.backend.command(s.command);
	s.tasks.pump();
	expect(s.createDriver).not.toHaveBeenCalled();
	const taskId = String(s.journal.snapshot().tasks[0]!.id);
	s.journal.putRecord("test-grant", "document-action", "action", taskId, {});
	finish();
	const receipt = await pending;
	expect(await concurrentRetry).toEqual(receipt);
	expect(await s.backend.command(s.command)).toEqual(receipt);
	expect(s.authorizeDocument).toHaveBeenCalledTimes(1);
	expect(s.createDriver).toHaveBeenCalledTimes(1);
	await s.tasks.stop();
	s.backend.dispose();
	s.journal.close();
});
it("preserves failed admission without a model call or repeated authorization", async () => {
	const s = setup(
		vi.fn(async () => {
			throw new Error("No authorized target");
		}),
	);
	expect(await s.backend.command(s.command)).toMatchObject({
		admissionError: "No authorized target",
	});
	await s.backend.command(s.command);
	s.tasks.pump();
	expect(s.authorizeDocument).toHaveBeenCalledTimes(1);
	expect(s.createDriver).not.toHaveBeenCalled();
	expect(s.journal.snapshot().tasks[0]?.state).toBe("failed");
	s.backend.dispose();
	s.journal.close();
});
it("rejects cross-conversation cancellation and closes all new admission on stop", async () => {
	const s = setup();
	const { documentAction, type, ...input } = s.command;
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

it("resumes committed pending admission after restart once its lifecycle is ready", async () => {
	const s = setup();
	const { type, ...input } = s.command;
	const receipt = s.journal.accept(input);
	s.authorizeDocument.mockImplementation(async () => {
		s.journal.putRecord(
			"recovered-grant",
			"document-action",
			"action",
			receipt.taskId,
			{},
		);
	});
	await s.backend.resumeAdmissions();
	expect(s.authorizeDocument).not.toHaveBeenCalled();
	s.registry.register({
		lifecycleInstanceId: "lifecycle",
		processId: 123,
		processStartTime: "start",
		hostEpoch: "epoch",
		attachmentGeneration: "g",
		capabilities: [],
		documents: [],
		admission: "recovering",
		label: "Rhino",
	});
	s.registry.markReady("lifecycle", {
		authenticated: true,
		generation: "g",
		operationsIdle: true,
		rhinoScopeIdle: true,
		grasshopperScopeIdle: true,
	});
	await s.backend.resumeAdmissions();
	expect(s.authorizeDocument).toHaveBeenCalledTimes(1);
	expect(s.createDriver).toHaveBeenCalledTimes(1);
	await s.tasks.stop();
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
it("drains accepted authorization before shutdown closes the journal", async () => {
	let finish!: () => void;
	const s = setup(
		vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		),
	);
	const pending = s.backend.command(s.command);
	s.backend.stopAdmission();
	await s.tasks.stop();
	let drained = false;
	const drain = s.backend.drainAdmissions().then(() => {
		drained = true;
	});
	await Promise.resolve();
	expect(drained).toBe(false);
	finish();
	await pending;
	await drain;
	expect(s.journal.snapshot().tasks[0]?.state).toBe("cancelled");
	expect(s.createDriver).not.toHaveBeenCalled();
	s.backend.dispose();
	s.journal.close();
});

it("scopes launch recovery to the launch's original root and conversation", async () => {
	const s = setup();
	const { documentAction: _action, ...submission } = s.command;
	const receipt = s.journal.accept(submission);
	s.journal.putRecord("launch", "launch", "launch", receipt.taskId, {
		dispatchAttempted: true,
	});
	s.journal.transitionRecord("launch", "launch", "accepted", "cancelled", {
		dispatchAttempted: true,
	});
	const command = {
		type: "recover_launch" as const,
		requestId: "recovery",
		conversationId: s.command.conversationId,
		taskId: receipt.taskId,
		launchRequestId: "launch",
		acknowledgement: "Inspected autosave dialogs and closed Rhino",
	};
	await expect(
		s.backend.command({ ...command, conversationId: "other" }),
	).rejects.toThrow("conversation");
	await expect(
		s.backend.command({ ...command, launchRequestId: "other-launch" }),
	).rejects.toThrow("root task");
	expect(s.recoverLaunch).not.toHaveBeenCalled();
	await expect(s.backend.command(command)).resolves.toEqual({ id: "launch" });
	expect(s.recoverLaunch).toHaveBeenCalledWith(
		"recovery",
		receipt.taskId,
		"launch",
		command.acknowledgement,
	);
	expect(
		s.journal.snapshot().records.find((row) => row.id === "launch")!.state,
	).toBe("cancelled");
	await s.tasks.stop();
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
