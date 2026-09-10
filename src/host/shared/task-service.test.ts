import { describe, it, expect, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import {
	SharedTaskService,
	type DriverContext,
	type TaskDriver,
} from "./task-service.js";
import type { TargetBinding } from "../../protocol/shared-execution.js";
const binding = (id: string): TargetBinding => ({
	kind: "rhino",
	lifecycleInstanceId: id,
	rhinoDocumentId: "doc",
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(maxWorkers?: number) {
	const journal = new TaskJournal(":memory:");
	const contexts: DriverContext[] = [],
		finish = new Map<string, () => void>(),
		clean = new Map<string, (confirmed?: boolean) => void>();
	const pause = vi.fn(async (_context: DriverContext) => ({ confirmed: true }));
	const resume = vi.fn(async (_context: DriverContext) => {});
	const service = new SharedTaskService(journal, {
		maxWorkers,
		resolveBinding: (b) => ({
			processKey: b.lifecycleInstanceId,
			attachmentGeneration: "generation",
		}),
		validateBinding: () => {},
		createDriver: (context) => {
			contexts.push(context);
			return {
				pauseGeometry: () => pause(context),
				resumeGeometry: () => resume(context),
				run: () =>
					new Promise<void>((resolve) => finish.set(context.taskId, resolve)),
				steer: async () => {},
				cancel: () => {
					finish.get(context.taskId)?.();
				},
				cleanup: () =>
					new Promise((resolve) =>
						clean.set(context.taskId, (confirmed = true) => resolve({ confirmed })),
					),
			} satisfies TaskDriver;
		},
	});
	function submit(
		conversation: string,
		target: string,
		request = conversation,
	) {
		journal.registerSession(conversation, conversation);
		return service.submit({
			requestId: request,
			conversationId: conversation,
			sessionId: conversation,
			kind: "prompt",
			text: "edit",
			bindings: [binding(target)],
			attachments: [],
		});
	}
	return { journal, service, contexts, finish, clean, submit, pause, resume };
}
describe("shared scheduling", () => {
	it("holds a process through cleanup while another process runs", async () => {
		const s = setup(),
			a = s.submit("a", "p"),
			b = s.submit("b", "p"),
			c = s.submit("c", "q");
		await tick();
		expect(s.contexts.map((c) => c.taskId)).toEqual([a.taskId, c.taskId]);
		const waiting = s.journal.snapshot().records.find((record) => record.kind === "scheduling" && record.task_id === b.taskId)!;
		expect(JSON.parse(String(waiting.payload))).toEqual({
			reason: "Waiting for an earlier task in this Rhino instance to finish.",
			blockingTaskId: a.taskId,
		});
		s.finish.get(a.taskId)!();
		await tick();
		expect(s.contexts).toHaveLength(2);
		s.clean.get(a.taskId)!();
		await tick();
		expect(s.contexts.map((c) => c.taskId)).toContain(b.taskId);
		expect(s.journal.snapshot().records.find((record) => record.kind === "scheduling" && record.task_id === b.taskId)?.state).toBe("ready");
	});
	it.each([true, false])("schedules a second document according to confirmed cleanup (%s), even after a greeting with no native calls", async (confirmed) => {
		const s = setup();
		const first = s.submit("first", "p");
		await tick();
		s.finish.get(first.taskId)!();
		await tick();
		s.clean.get(first.taskId)!(confirmed);
		await tick();
		s.journal.registerSession("second", "second");
		const second = s.service.submit({
			requestId: "second",
			conversationId: "second",
			sessionId: "second",
			kind: "prompt",
			text: "model hello world",
			bindings: [{ kind: "rhino", lifecycleInstanceId: "p", rhinoDocumentId: "doc-2" }],
			attachments: [],
		});
		await tick();
		expect(s.journal.snapshot().operations).toHaveLength(0);
		expect(s.journal.snapshot().tasks.find((task) => task.id === second.taskId)?.state).toBe(confirmed ? "running" : "queued");
		if (!confirmed) {
			const record = s.journal.snapshot().records.find((record) => record.kind === "scheduling" && record.task_id === second.taskId)!;
			expect(JSON.parse(String(record.payload))).toEqual({
				reason: "Waiting for recovery of an earlier task in this Rhino instance.",
				blockingTaskId: first.taskId,
			});
			const events = s.journal.snapshot().events.filter((event) => event.task_id === second.taskId && event.kind === "task_waiting_for_target");
			expect(JSON.parse(String(events[0]!.payload))).toMatchObject({ blockingTaskId: first.taskId });
			s.service.pump();
			expect(s.journal.snapshot().events.filter((event) => event.task_id === second.taskId && event.kind === "task_waiting_for_target")).toHaveLength(events.length);
			await s.service.cancel(second.taskId);
		} else {
			s.finish.get(second.taskId)!();
			await tick();
			s.clean.get(second.taskId)!();
			await tick();
		}
		s.journal.close();
	});
	it("persists question before cleanup and answers into one fresh turn", async () => {
		const s = setup(),
			a = s.submit("a", "p");
		await tick();
		const q = s.contexts[0]!.ask("call", { prompt: "Choose" });
		expect(() => s.service.answer("answer", q, "yes")).toThrow(
			"not answerable",
		);
		s.finish.get(a.taskId)!();
		await tick();
		s.clean.get(a.taskId)!();
		await tick();
		const answer = s.service.answer("answer", q, "yes");
		expect(answer.turnId).not.toBe(a.turnId);
		expect(s.service.answer("answer", q, "yes")).toEqual(answer);
		await tick();
		expect(s.contexts).toHaveLength(2);
		expect(s.contexts[1]!.continuation).toMatchObject({ answer: "yes" });
	});
	it("cancellation wins over question answers and waits for cleanup", async () => {
		const s = setup(),
			a = s.submit("a", "p");
		await tick();
		const q = s.contexts[0]!.ask("call", {});
		await s.service.cancel(a.taskId);
		await tick();
		expect(() => s.service.answer("x", q, {})).toThrow();
		expect(s.service.snapshot().tasks[0]!.state).toBe("suspending");
		s.clean.get(a.taskId)!();
		await tick();
		expect(s.service.snapshot().tasks[0]!.state).toBe("cancelled");
	});
	it("unknown native outcome blocks same-process work despite successful cleanup", async () => {
		const s = setup(),
			a = s.submit("a", "p");
		await tick();
		s.journal.operationIntent({
			taskId: a.taskId,
			turnId: a.turnId,
			name: "runRhinoScript",
			operationClass: "mutation",
			arguments: {},
			deadline: 100,
		});
		const b = s.submit("b", "p");
		s.finish.get(a.taskId)!();
		await tick();
		s.clean.get(a.taskId)!();
		await tick();
		expect(s.service.snapshot().tasks[0]!.state).toBe("uncertain");
		expect(s.contexts.map((c) => c.taskId)).not.toContain(b.taskId);
		expect(() =>
			s.journal.recoveryDisposition("recovery", a.taskId, {
				acknowledged: true,
				inspectedBaseline: {},
			}),
		).toThrow();
		s.journal.recoveryDisposition("recovery", a.taskId, {
			acknowledged: true,
			originalProcessExited: true,
			inspectedBaseline: {},
		});
		s.service.releaseRecovered(a.taskId);
		await tick();
		expect(s.contexts.map((c) => c.taskId)).toContain(b.taskId);
		expect(s.service.snapshot().operations[0]!.state).toBe("dispatched");
	});
	it("deduplicates accepted work before invoking a model", async () => {
		const s = setup(),
			a = s.submit("a", "p");
		expect(s.submit("a", "p")).toEqual(a);
		await tick();
		expect(s.contexts).toHaveLength(1);
	});
});

it("stop waits for confirmed driver cleanup before the journal can close", async () => {
	const s = setup(),
		receipt = s.submit("a", "p");
	await tick();
	let stopped = false;
	const stop = s.service.stop().then(() => {
		stopped = true;
	});
	await tick();
	expect(stopped).toBe(false);
	s.clean.get(receipt.taskId)!();
	await stop;
	expect(stopped).toBe(true);
	expect(s.journal.snapshot().tasks[0]!.state).toBe("cancelled");
	s.journal.close();
});
it("a coordinator question does not wait for a running child", async () => {
	const s = setup();
	s.journal.registerSession("root", "root");
	const root = s.service.submit({
		requestId: "root",
		conversationId: "root",
		sessionId: "root",
		kind: "prompt",
		text: "coordinate",
		bindings: [binding("p"), binding("q")],
		attachments: [],
	});
	await tick();
	const child = s.service.delegate({
		requestId: "child",
		conversationId: "root",
		sessionId: "worker",
		parentTaskId: root.taskId,
		dependencies: [],
		kind: "prompt",
		text: "work",
		bindings: [binding("p")],
		attachments: [],
	});
	await tick();
	s.contexts
		.find((c) => c.taskId === root.taskId)!
		.ask("root-question", { text: "Choose" });
	s.finish.get(root.taskId)!();
	await tick();
	expect(s.clean.has(root.taskId)).toBe(true);
	s.clean.get(root.taskId)!();
	await tick();
	expect(
		s.service.snapshot().tasks.find((t) => t.id === root.taskId)!.state,
	).toBe("awaiting_user");
	expect(
		s.service.snapshot().tasks.find((t) => t.id === child.taskId)!.state,
	).toBe("running");
});
it("does not run an accepted document action before its authorization commits", async () => {
	const s = setup();
	s.journal.registerSession("a", "a");
	const receipt = s.service.submit({
		requestId: "pending",
		conversationId: "a",
		sessionId: "a",
		kind: "prompt",
		text: "create",
		bindings: [],
		attachments: [],
		documentAction: { action: "new" },
	});
	s.service.pump();
	await tick();
	expect(s.contexts).toHaveLength(0);
	expect(() => s.journal.start(receipt.taskId, receipt.turnId)).toThrow(
		"admission",
	);
	s.journal.finishAdmission(receipt.taskId, "No validated installation");
	s.service.pump();
	expect(s.service.snapshot().tasks[0]!.state).toBe("failed");
});
it("does not start a model when the usage budget is exhausted", () => {
	const journal = new TaskJournal(":memory:");
	journal.registerSession("a", "a");
	let started = false;
	const service = new SharedTaskService(journal, {
		maxUsage: 0,
		resolveBinding: () => ({ processKey: "p", attachmentGeneration: "g" }),
		validateBinding: () => {},
		createDriver: () => {
			started = true;
			throw new Error("must not start");
		},
	});
	service.submit({
		requestId: "budget",
		conversationId: "a",
		sessionId: "a",
		kind: "prompt",
		text: "work",
		bindings: [],
		attachments: [],
	});
	expect(started).toBe(false);
	expect(journal.snapshot().tasks[0]!.state).toBe("failed");
});
it("terminalizes a queued child whose dependency becomes uncertain", async () => {
	const s = setup();
	s.journal.registerSession("root", "root");
	const root = s.service.submit({
		requestId: "root",
		conversationId: "root",
		sessionId: "root",
		kind: "prompt",
		text: "coordinate",
		bindings: [binding("p"), binding("q")],
		attachments: [],
	});
	await tick();
	const first = s.service.delegate({
		requestId: "first",
		conversationId: "root",
		sessionId: "first-worker",
		parentTaskId: root.taskId,
		dependencies: [],
		kind: "prompt",
		text: "first",
		bindings: [binding("p")],
		attachments: [],
	});
	await tick();
	const second = s.service.delegate({
		requestId: "second",
		conversationId: "root",
		sessionId: "second-worker",
		parentTaskId: root.taskId,
		dependencies: [first.taskId],
		kind: "prompt",
		text: "second",
		bindings: [binding("q")],
		attachments: [],
	});
	s.journal.operationIntent({
		taskId: first.taskId,
		turnId: first.turnId,
		name: "runRhinoScript",
		operationClass: "mutation",
		arguments: {},
		deadline: 100,
	});
	s.finish.get(first.taskId)!();
	await tick();
	s.clean.get(first.taskId)!();
	await tick();
	const children = await s.service.waitForChildren(root.taskId);
	expect(children.tasks.map((task) => task.state)).toEqual([
		"uncertain",
		"failed",
	]);
	expect(s.contexts.some((context) => context.taskId === second.taskId)).toBe(
		false,
	);
});
it("bounds coordinator sessions without starving geometry workers", async () => {
	const journal = new TaskJournal(":memory:"),
		started: string[] = [];
	const service = new SharedTaskService(journal, {
		maxCoordinators: 1,
		maxWorkers: 1,
		resolveBinding: (b) => ({
			processKey: b.lifecycleInstanceId,
			attachmentGeneration: "g",
		}),
		validateBinding: () => {},
		createDriver: (context) => {
			started.push(context.taskId);
			return {
				run: () => new Promise<void>(() => {}),
				steer: async () => {},
				cancel: () => {},
				cleanup: async () => ({ confirmed: true }),
			};
		},
	});
	const submit = (id: string, bindings: TargetBinding[]) => {
		journal.registerSession(id, id);
		return service.submit({
			requestId: id,
			conversationId: id,
			sessionId: id,
			kind: "prompt",
			text: "Work",
			bindings,
			attachments: [],
		});
	};
	const a = submit("a", []),
		b = submit("b", []),
		c = submit("c", [binding("p")]);
	await tick();
	expect(started).toEqual([a.taskId, c.taskId]);
	expect(
		journal.snapshot().tasks.find((task) => task.id === b.taskId)?.state,
	).toBe("queued");
});
it("keeps failed driver initialization uncertain when native cleanup was not confirmed", async () => {
	const journal = new TaskJournal(":memory:");
	journal.registerSession("a", "a");
	const service = new SharedTaskService(journal, {
		resolveBinding: () => ({ processKey: "p", attachmentGeneration: "g" }),
		validateBinding: () => {},
		createDriver: () => {
			throw Object.assign(new Error("Setup failed"), {
				cleanupConfirmed: false,
			});
		},
	});
	service.submit({
		requestId: "a",
		conversationId: "a",
		sessionId: "a",
		kind: "prompt",
		text: "Work",
		bindings: [binding("p")],
		attachments: [],
	});
	await tick();
	expect(journal.snapshot().tasks[0]?.state).toBe("uncertain");
	journal.close();
});

it("keeps ownership of the selected document while delegating to another instance", async () => {
	const s = setup();
	s.journal.registerSession("conversation", "session");
	const first = binding("first"), second = binding("second"), forbidden = binding("third");
	const root = s.service.submit({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Compare these models", bindings: [first, second], messageTarget: second, attachments: [] });
	await tick();
	expect(s.contexts[0]).toMatchObject({ binding: second, messageTarget: second, accessibleBindings: [first, second], owner: { binding: second } });
	const child = { requestId: "child", parentTaskId: root.taskId, dependencies: [], conversationId: "conversation", sessionId: "worker", kind: "prompt" as const, text: "Read first model", bindings: [first], attachments: [] };
	s.service.delegate(child);
	await tick();
	expect(s.contexts[1]).toMatchObject({ binding: first, accessibleBindings: [first] });
	expect(() => s.service.delegate({ ...child, requestId: "forbidden", sessionId: "other-worker", bindings: [forbidden] })).toThrow("Child binding is not authorized");
});


it.each(["same Rhino process", "single worker slot"])("releases and restores the selected document when children need the %s", async (scenario) => {
	const s = setup(scenario === "single worker slot" ? 1 : 4);
	s.journal.registerSession("conversation", "session");
	const selected = binding("selected");
	const target = scenario === "same Rhino process" ? { ...selected, rhinoDocumentId: "other-document" } : binding("other-instance");
	const root = s.service.submit({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Edit this document and inspect the other one", bindings: [selected, target], messageTarget: selected, attachments: [] });
	await tick();
	const originalOwner = s.journal.snapshot().turns[0]!.owner;
	expect(JSON.parse(String(originalOwner)).binding).toEqual(selected);
	const child = s.service.delegate({ requestId: "child", parentTaskId: root.taskId, dependencies: [], conversationId: "conversation", sessionId: "worker", kind: "prompt", text: "Inspect the other document", bindings: [target], attachments: [] });
	await tick();
	expect(s.contexts).toHaveLength(1);
	const waiting = s.service.waitForChildren(root.taskId);
	await tick();
	expect(s.pause).toHaveBeenCalledWith(s.contexts[0]);
	expect(s.contexts[1]!.owner?.binding).toEqual(target);
	expect(s.journal.snapshot().turns[0]!.owner).toBe(originalOwner);
	expect(s.resume).not.toHaveBeenCalled();
	s.finish.get(child.taskId)!();
	await tick();
	s.clean.get(child.taskId)!();
	await waiting;
	expect(s.resume).toHaveBeenCalledWith(s.contexts[0]);
	expect(s.journal.snapshot().turns[0]!.owner).toBe(originalOwner);
	s.finish.get(root.taskId)!();
	await tick();
	s.clean.get(root.taskId)!();
	await tick();
	expect(s.journal.snapshot().tasks.every((task) => task.state === "completed")).toBe(true);
	s.journal.close();
});

it("keeps the process locked when pausing the main task cannot confirm cleanup", async () => {
	const s = setup();
	s.journal.registerSession("conversation", "session");
	const selected = binding("selected"), sibling = { ...selected, rhinoDocumentId: "sibling" };
	const root = s.service.submit({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Inspect both", bindings: [selected, sibling], messageTarget: selected, attachments: [] });
	await tick();
	s.service.delegate({ requestId: "child", parentTaskId: root.taskId, dependencies: [], conversationId: "conversation", sessionId: "worker", kind: "prompt", text: "Inspect sibling", bindings: [sibling], attachments: [] });
	s.pause.mockResolvedValueOnce({ confirmed: false });
	await expect(s.service.waitForChildren(root.taskId)).rejects.toThrow("cleanup must be confirmed");
	expect(s.contexts).toHaveLength(1);
	expect(s.resume).not.toHaveBeenCalled();
	await s.service.cancel(root.taskId);
	await tick();
	s.clean.get(root.taskId)!();
	await tick();
	s.journal.close();
});


it("cancels a main task while it waits without reacquiring its document", async () => {
	const s = setup(1);
	s.journal.registerSession("conversation", "session");
	const selected = binding("selected"), other = binding("other");
	const root = s.service.submit({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Compare", bindings: [selected, other], messageTarget: selected, attachments: [] });
	await tick();
	const child = s.service.delegate({ requestId: "child", parentTaskId: root.taskId, dependencies: [], conversationId: "conversation", sessionId: "worker", kind: "prompt", text: "Inspect", bindings: [other], attachments: [] });
	const waiting = s.service.waitForChildren(root.taskId);
	const rejected = expect(waiting).rejects.toThrow("cancelled");
	await tick();
	expect(s.contexts).toHaveLength(2);
	await s.service.cancel(root.taskId);
	await rejected;
	await tick();
	expect(s.resume).not.toHaveBeenCalled();
	s.clean.get(child.taskId)!();
	s.clean.get(root.taskId)!();
	await tick();
	expect(s.journal.snapshot().tasks.every((task) => task.state === "cancelled")).toBe(true);
	s.journal.close();
});
