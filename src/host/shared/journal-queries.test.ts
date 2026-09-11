import { expect, it, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedTaskService } from "./task-service.js";

it("keeps scheduling data independent of completed image history and delivers selected payloads intact", async () => {
	const journal = new TaskJournal(":memory:");
	const current = journal.createConversation("current", "Current");
	const old = journal.createConversation("old", "Old");
	const image = { type: "image", mimeType: "image/png", data: "x".repeat(1_000_000) };
	const task = journal.accept({ ...current, requestId: "current-task", kind: "prompt", text: "Inspect", bindings: [], attachments: [image] });
	const before = journal.schedulingSnapshot();
	for (let i = 0; i < 20; i++) {
		const prior = journal.accept({ ...old, requestId: `old-${i}`, kind: "prompt", text: "Old", bindings: [], attachments: [image] });
		journal.start(prior.taskId, prior.turnId);
		journal.publish(prior.taskId, { image });
		journal.settle(prior.taskId, prior.turnId, "completed");
	}
	expect(journal.schedulingSnapshot()).toEqual(before);
	expect(JSON.stringify(before).length).toBeLessThan(2_000);
	const exported = journal.conversationSnapshot(current.conversationId);
	expect(exported.tasks.map(row => row.id)).toEqual([task.taskId]);
	expect(JSON.parse(String(exported.tasks[0]!.payload)).attachments).toEqual([image]);
	const full = journal.snapshot();
	for (const key of ["turns", "inputs", "questions", "events", "operations", "recoveries", "records", "dependencies"] as const)
		expect(exported[key]).toEqual(full[key].filter(row => row.task_id === task.taskId));
	const unbounded = vi.spyOn(journal, "snapshot").mockImplementation(() => { throw new Error("Scheduling must not load the complete journal"); });
	let delivered: unknown;
	const service = new SharedTaskService(journal, {
		resolveBinding: () => { throw new Error("No binding expected"); }, validateBinding: () => {},
		createDriver: context => {
			delivered = context.attachments;
			return { run: async () => {}, steer: async () => {}, cancel: () => {}, cleanup: async () => ({ confirmed: true }) };
		},
	});
	try {
		service.pump();
		await expect.poll(() => journal.getTask(task.taskId)?.state).toBe("completed");
		expect(delivered).toEqual([image]);
		expect(unbounded).not.toHaveBeenCalled();
	} finally { await service.stop(); journal.close(); }
});

it("retains finished siblings and their usage while excluding their large payloads", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const chat = journal.createConversation("chat", "Chat");
		const input = { ...chat, kind: "prompt" as const, text: "Work", bindings: [{ kind: "rhino" as const, lifecycleInstanceId: "rhino", rhinoDocumentId: "doc" }], attachments: [] };
		const root = journal.accept({ ...input, requestId: "root" });
		journal.start(root.taskId, root.turnId);
		const child = journal.delegate({ ...input, requestId: "child", sessionId: "child-session", parentTaskId: root.taskId, dependencies: [] });
		journal.start(child.taskId, child.turnId);
		journal.recordUsage(child.taskId, child.turnId, 123);
		journal.settle(child.taskId, child.turnId, "completed");
		const next = journal.delegate({ ...input, requestId: "next", sessionId: "next-session", parentTaskId: root.taskId, dependencies: [child.taskId] });
		const snapshot = journal.schedulingSnapshot();
		expect(snapshot.tasks.find(row => row.id === child.taskId)?.state).toBe("completed");
		expect(snapshot.turns.find(row => row.id === child.turnId)?.usage).toBe(123);
		expect(snapshot.dependencies).toContainEqual({ task_id: next.taskId, dependency_id: child.taskId });
	} finally { journal.close(); }
});
