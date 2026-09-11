import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedNativeRuntime } from "./native-runtime.js";
import { SharedTaskService, type DriverContext } from "./task-service.js";
import { admitCurrentToolDispatch, ToolPolicyDenied } from "../../services/tool-policy-context.js";
import { getRuntimeRpc } from "../../infra/runtime-rpc.js";
import type { ExecutionOwner, TargetBinding } from "../../protocol/shared-execution.js";

const wire = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../infra/connection.js", () => ({ resolveConnection: () => ({
	rpcEndpoint: "tcp://127.0.0.1:50101", pubEndpoint: "tcp://127.0.0.1:50102", lifecycleInstanceId: "life", token: "test",
}) }));
vi.mock("../../infra/rpc-client.js", async (original) => ({
	...await original<typeof import("../../infra/rpc-client.js")>(),
	HopperRpcClient: class {
		identity = "client";
		connect = async () => {};
		close = async () => {};
		call = (...args: unknown[]) => wire.call(...args);
	},
}));

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const binding = (document: string): TargetBinding => ({ kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: document });
let activeDocument: string;
let scope: ExecutionOwner | null;
let epoch: number;
let trace: string[];
let holdScript: ReturnType<typeof deferred> | undefined;
let failCommit: boolean;
let holdActivation: ReturnType<typeof deferred> | undefined;
const journals: TaskJournal[] = [];
afterEach(() => { for (const journal of journals.splice(0)) journal.close(); });
beforeEach(() => {
	activeDocument = "a"; scope = null; epoch = 0; trace = []; holdScript = undefined; holdActivation = undefined; failCommit = false;
	const segment = () => ({ documentId: scope ? activeDocument : null, segmentId: scope ? `segment-${epoch}` : null,
		epoch, state: scope ? "active" : "idle", lifecycleInstanceId: "life" });
	wire.call.mockReset();
	wire.call.mockImplementation(async (operation: string, args: any = {}, options: any = {}) => {
		const owner = options.executionOwner as ExecutionOwner | undefined;
		let data: unknown = {};
		if (operation === "lifecycleHandshake") data = { attachmentGeneration: "generation" };
		else if (operation === "listRhinoDocuments") data = { activeDocumentId: activeDocument,
			documents: ["a", "b"].map((id) => ({ documentId: id, stateToken: `state-${id}`, hopperInitialized: true })) };
		else if (operation === "listGrasshopperDocuments") data = { documents: [] };
		else if (operation === "getDocumentTransactionState") data = args.owner === "rhino" ? segment()
			: { ...segment(), documentId: null, segmentId: null, state: "idle" };
		else if (operation === "manageRhinoDocument") {
			await holdActivation?.promise;
			await admitCurrentToolDispatch();
			expect(scope).toBeNull();
			expect(args.action).toBe("activate");
			expect(args.expectedActiveDocument).toBe(activeDocument);
			expect(owner!.binding).toEqual(binding(args.documentId));
			activeDocument = args.documentId;
			trace.push(`activate:${activeDocument}`);
			data = { ok: true, transaction: segment() };
		} else if (operation === "beginRhinoAgentTransaction") {
			expect(scope).toBeNull();
			expect(owner!.binding).toEqual(binding(activeDocument));
			scope = owner!; epoch++;
			trace.push(`begin:${activeDocument}`);
			data = { transaction: segment() };
		} else if (operation === "runRhinoScript") {
			expect(scope).toEqual(owner);
			expect(owner!.binding).toEqual(binding(activeDocument));
			trace.push(`script:${activeDocument}`);
			await holdScript?.promise;
			data = { ok: true, transaction: segment() };
		} else if (operation === "commitRhinoAgentTransaction" || operation === "cancelRhinoAgentTransaction") {
			expect(scope).toEqual(owner);
			if (failCommit) throw new Error("Lost native cleanup acknowledgement");
			trace.push(`${operation.startsWith("commit") ? "commit" : "cancel"}:${activeDocument}`);
			scope = null; epoch++;
			data = { transaction: segment() };
		}
		return { operation, lifecycleInstanceId: "life", result: { class: "completed", reasonCode: "OK", data } };
	});
});

async function fixture(maxWorkers = 4) {
	const journal = new TaskJournal(":memory:"); journals.push(journal);
	const registry = new SharedRegistry(journal);
	const native = new SharedNativeRuntime("epoch", registry, journal, () => true);
	await native.register({ profilePath: "/profile.json", hostEpoch: "epoch", process: { pid: 123, startIdentity: "start" } });
	await native.refresh();
	const contexts = new Map<string, DriverContext>();
	const geometry = new Map<string, Awaited<ReturnType<typeof native.geometry>>>();
	const finishes = new Map<string, ReturnType<typeof deferred>>();
	const service = new SharedTaskService(journal, {
		maxWorkers,
		resolveBinding: (target) => registry.resolveBinding(target),
		resolveLifecycle: (id) => registry.resolveLifecycle(id),
		validateBinding: (owner) => registry.validateBinding(owner),
		createDriver: async (context) => {
			contexts.set(context.taskId, context);
			const tools = await native.geometry(context); geometry.set(context.taskId, tools);
			const finished = deferred(); finishes.set(context.taskId, finished);
			return { run: () => finished.promise, steer: async () => {}, cancel: () => finished.resolve(), cleanup: tools.cleanup };
		},
	});
	journal.registerSession("conversation", "session");
	const root = service.submit({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt",
		text: "Edit both models", bindings: [binding("a"), binding("b")], messageTarget: binding("a"), attachments: [] });
	await tick();
	const children = ["a", "b"].map((id) => service.delegate({ requestId: id, parentTaskId: root.taskId, dependencies: [],
		conversationId: "conversation", sessionId: `worker-${id}`, kind: "prompt", text: `Edit ${id}`, bindings: [binding(id)], attachments: [] }));
	await tick();
	const script = (taskId: string) => geometry.get(taskId)!.runTool!("rh_run_script", async () => getRuntimeRpc().request("runRhinoScript", { mode: "python", source: "pass" }));
	const finish = async (taskId: string) => { finishes.get(taskId)!.resolve(); await tick(); };
	return { journal, registry, service, contexts, geometry, root, children, script, finish };
}

it("starts both same-process agents before either finishes and interleaves tools with real RuntimeRpc transaction cleanup", async () => {
	const f = await fixture();
	const [a, b] = f.children;
	expect(f.contexts.size).toBe(3);
	expect(f.journal.snapshot().tasks.every((task) => task.state === "running")).toBe(true);
	expect(trace).toEqual([]); // Model startup does not activate or reserve a document.
	holdScript = deferred();
	const first = f.script(a!.taskId);
	await tick();
	const second = f.script(b!.taskId);
	await tick();
	expect(trace).toEqual(["begin:a", "script:a"]);
	expect(f.journal.snapshot().records.some((record) => record.task_id === b!.taskId && record.kind === "scheduling" && record.state === "blocked")).toBe(true);
	const third = f.script(a!.taskId);
	holdScript.resolve();
	await Promise.all([first, second, third]);
	expect(trace).toEqual(["begin:a", "script:a", "commit:a", "activate:b", "begin:b", "script:b", "commit:b", "activate:a", "begin:a", "script:a", "commit:a"]);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
	expect(f.journal.snapshot().tasks.every((task) => task.state === "completed")).toBe(true);
});

it("rechecks the captured attachment before dispatching a waiting tool", async () => {
	const f = await fixture(); const [a, b] = f.children;
	holdScript = deferred();
	const first = f.script(a!.taskId); await tick();
	const second = f.script(b!.taskId);
	const rejected = expect(second).rejects.toThrow("attachment changed");
	await tick();
	const resolve = f.registry.resolveBinding.bind(f.registry);
	vi.spyOn(f.registry, "resolveBinding").mockImplementation((target) => ({ ...resolve(target),
		...(target.kind === "rhino" && target.rhinoDocumentId === "b" ? { attachmentGeneration: "replacement" } : {}) }));
	holdScript.resolve(); await first; await rejected;
	expect(trace).toEqual(["begin:a", "script:a", "commit:a"]);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
});

it.each(["lease", "transport"])("rechecks tool admission after waiting for %s without activating a revoked tool's document", async (stage) => {
	const f = await fixture(); const [a, b] = f.children;
	holdScript = deferred();
	const first = f.script(a!.taskId); await tick();
	let allowed = true;
	const work = vi.fn(async () => {});
	const second = f.geometry.get(b!.taskId)!.runTool("rh_run_script", work, async () => {
		if (!allowed) throw new ToolPolicyDenied("revoked");
	});
	const rejected = expect(second).rejects.toThrow("revoked");
	await tick();
	if (stage === "transport") {
		holdActivation = deferred();
		holdScript.resolve(); await first; await tick();
	}
	allowed = false;
	holdActivation?.resolve();
	holdScript.resolve(); await first; await rejected;
	expect(f.journal.snapshot().operations.some((operation) => operation.state === "uncertain")).toBe(false);
	expect(work).not.toHaveBeenCalled();
	expect(trace).toEqual(["begin:a", "script:a", "commit:a"]);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
});

it("cancels a queued native call without touching the other agent's open transaction", async () => {
	const f = await fixture(); const [a, b] = f.children;
	holdScript = deferred();
	const first = f.script(a!.taskId); await tick();
	const second = f.script(b!.taskId);
	const rejected = expect(second).rejects.toThrow("cancelled");
	await tick();
	await f.service.cancel(b!.taskId); await rejected;
	expect(scope?.taskId).toBe(a!.taskId);
	expect(trace).toEqual(["begin:a", "script:a"]);
	holdScript.resolve(); await first;
	await f.finish(a!.taskId); await f.finish(f.root.taskId);
	expect(f.journal.snapshot().tasks.find((task) => task.id === b!.taskId)?.state).toBe("cancelled");
});

it("retains the process fence after uncertain cleanup and prevents the sibling from editing", async () => {
	const f = await fixture(); const [a, b] = f.children;
	failCommit = true;
	await expect(f.script(a!.taskId)).rejects.toThrow("cleanup acknowledgement");
	await expect(f.script(b!.taskId)).rejects.toThrow("requires recovery");
	expect(trace).toEqual(["begin:a", "script:a"]);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
	expect(f.journal.snapshot().tasks.find((task) => task.id === a!.taskId)?.state).toBe("uncertain");
});

it("identifies the task blocking an active sibling and queues new prompts before model startup", async () => {
	const f = await fixture(); const [a, b] = f.children;
	failCommit = true;
	await expect(f.script(a!.taskId)).rejects.toThrow("cleanup acknowledgement");
	// The model can still be responding after its native cleanup has failed.
	expect(f.journal.snapshot().tasks.find((task) => task.id === a!.taskId)?.state).toBe("running");
	await expect(f.script(b!.taskId)).rejects.toThrow(a!.taskId);
	await expect(f.script(b!.taskId)).rejects.toThrow("Hopper task recovery");
	f.journal.registerSession("new-chat", "new-session");
	const next = f.service.submit({ requestId: "next", conversationId: "new-chat", sessionId: "new-session",
		kind: "prompt", text: "Create another document", bindings: [binding("a")], attachments: [] });
	await tick();
	expect(f.contexts.has(next.taskId)).toBe(false);
	expect(f.journal.snapshot().tasks.find((task) => task.id === next.taskId)?.state).toBe("queued");
	const block = f.journal.snapshot().records.find((record) => record.task_id === next.taskId && record.kind === "scheduling")!;
	expect(JSON.parse(String(block.payload))).toMatchObject({
		blockingTaskId: a!.taskId,
		reason: expect.stringContaining('select "I\'ve checked, continue"'),
	});
	await f.service.cancel(next.taskId);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
});

it("releases a waiting parent's model slot so a single-slot host can finish all delegates", async () => {
	const f = await fixture(1); const [a, b] = f.children;
	expect(f.contexts.size).toBe(1);
	const wait = f.service.waitForChildren(f.root.taskId); await tick();
	expect(f.contexts.has(a!.taskId)).toBe(true);
	await f.script(a!.taskId); await f.finish(a!.taskId);
	expect(f.contexts.has(b!.taskId)).toBe(true);
	await f.script(b!.taskId); await f.finish(b!.taskId);
	await wait; await f.finish(f.root.taskId);
	expect(f.journal.snapshot().tasks.every((task) => task.state === "completed")).toBe(true);
});


it.each(["document", "lifecycle"])("queues a managed %s action between native tools in arrival order", async (kind) => {
	const f = await fixture();
	const [a, b] = f.children;
	holdScript = deferred();
	const first = f.script(a!.taskId);
	await tick();
	const action = async () => { expect(scope).toBeNull(); trace.push("managed"); };
	const managed = kind === "document"
		? f.service.withProcess(f.root.taskId, binding("b"), action)
		: f.service.withLifecycle(f.root.taskId, "life", action);
	const second = f.script(b!.taskId);
	await tick();
	expect(trace).toEqual(["begin:a", "script:a"]);
	holdScript.resolve();
	await Promise.all([first, managed, second]);
	expect(trace).toEqual(["begin:a", "script:a", "commit:a", "managed", "activate:b", "begin:b", "script:b", "commit:b"]);
	await f.finish(a!.taskId); await f.finish(b!.taskId); await f.finish(f.root.taskId);
});
