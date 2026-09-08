import { describe, it, expect } from "vitest";
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
function setup() {
	const journal = new TaskJournal(":memory:");
	const contexts: DriverContext[] = [],
		finish = new Map<string, () => void>(),
		clean = new Map<string, () => void>();
	const service = new SharedTaskService(journal, {
		resolveBinding: (b) => ({
			processKey: b.lifecycleInstanceId,
			attachmentGeneration: "generation",
		}),
		validateBinding: () => {},
		createDriver: (context) => {
			contexts.push(context);
			return {
				run: () =>
					new Promise<void>((resolve) => finish.set(context.taskId, resolve)),
				steer: async () => {},
				cancel: () => {
					finish.get(context.taskId)?.();
				},
				cleanup: () =>
					new Promise((resolve) =>
						clean.set(context.taskId, () => resolve({ confirmed: true })),
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
	return { journal, service, contexts, finish, clean, submit };
}
describe("shared scheduling", () => {
	it("holds a process through cleanup while another process runs", async () => {
		const s = setup(),
			a = s.submit("a", "p"),
			b = s.submit("b", "p"),
			c = s.submit("c", "q");
		await tick();
		expect(s.contexts.map((c) => c.taskId)).toEqual([a.taskId, c.taskId]);
		s.finish.get(a.taskId)!();
		await tick();
		expect(s.contexts).toHaveLength(2);
		s.clean.get(a.taskId)!();
		await tick();
		expect(s.contexts.map((c) => c.taskId)).toContain(b.taskId);
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
