import { afterEach, expect, it, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry, type SharedAttachment } from "./registry.js";
import { RhinoLaunchService } from "./rhino-launch.js";
import { RhinoNotStartedError, type RhinoProcessIdentity } from "./windows-rhino-process.js";
import type { DriverContext } from "./task-service.js";

const sourceBinding = { kind: "rhino" as const, lifecycleInstanceId: "source", rhinoDocumentId: "original" };
const workerBinding = { kind: "rhino" as const, lifecycleInstanceId: "worker", rhinoDocumentId: "blank" };
const executable = "C:\\Program Files\\Rhino 8\\System\\Rhino.exe";
const sourceProcess = { pid: 101, startIdentity: "source-start", executable };
const workerProcess = { pid: 202, startIdentity: "worker-start", executable };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });

function fixture(options: { ready?: boolean; platform?: string; allowsLaunch?: () => Promise<boolean> } = {}) {
	const journal = new TaskJournal(":memory:");
	cleanup.push(() => journal.close());
	journal.registerSession("conversation", "session");
	const receipt = journal.accept({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Delegate in another Rhino", bindings: [sourceBinding], attachments: [] });
	journal.start(receipt.taskId, receipt.turnId);
	const registry = new SharedRegistry(journal);
	function register(process: RhinoProcessIdentity, binding: typeof sourceBinding | typeof workerBinding, ready: boolean) {
		const attachment: SharedAttachment = { lifecycleInstanceId: binding.lifecycleInstanceId, processId: process.pid, processStartTime: process.startIdentity,
			hostEpoch: "epoch", attachmentGeneration: "generation", documents: [binding], capabilities: [], admission: "recovering", label: binding.lifecycleInstanceId };
		registry.register(attachment);
		if (ready) registry.markReady(binding.lifecycleInstanceId, { authenticated: true, generation: "generation", operationsIdle: true, rhinoScopeIdle: true, grasshopperScopeIdle: true });
	}
	register(sourceProcess, sourceBinding, true);
	const processes = new Map<number, RhinoProcessIdentity>([[101, sourceProcess]]);
	const inspect = vi.fn(async (pid: number) => processes.get(pid) ?? null);
	const spawn = vi.fn(async (_executable: string, onSpawn: (pid: number) => void) => {
		expect(journal.snapshot().records.find(row => row.kind === "launch")?.state).toBe("dispatched");
		onSpawn(202);
		processes.set(202, workerProcess);
		register(workerProcess, workerBinding, options.ready ?? true);
		return workerProcess;
	});
	const controller = new AbortController();
	const context: DriverContext = { taskId: receipt.taskId, turnId: receipt.turnId, parentTaskId: null, sessionId: "session", conversationId: "conversation", binding: sourceBinding,
		accessibleBindings: [sourceBinding], owner: null, signal: controller.signal, text: "", attachments: [], continuation: null, ask: () => "", requestDocumentAction: () => "", publish: () => {} };
	const serviceOptions = { platform: options.platform ?? "win32", adapter: { inspect, spawn }, timeoutMs: 20, pollMs: 1, allowsLaunch: options.allowsLaunch };
	const service = new RhinoLaunchService(journal, registry, serviceOptions);
	return { journal, registry, context, service, serviceOptions, processes, inspect, spawn, controller, register, receipt };
}

it("starts once, verifies readiness, grants delegation access and preserves the parent's target", async () => {
	const f = fixture();
	const results = await Promise.all([f.service.launch(f.context, { requestId: "one" }), f.service.launch(f.context, { requestId: "one" })]);
	expect(results[0].binding).toEqual(workerBinding);
	expect(results[1]).toEqual(results[0]);
	expect(f.spawn).toHaveBeenCalledTimes(1);
	expect(f.spawn.mock.calls[0]![0]).toBe(executable);
	expect(f.journal.authorizationAdditions(f.context.taskId)).toEqual([workerBinding]);
	expect(f.context.binding).toEqual(sourceBinding);
	const child = f.journal.delegate({ requestId: "child", conversationId: "conversation", sessionId: "child-session", parentTaskId: f.context.taskId, dependencies: [], kind: "prompt", text: "Build here", bindings: [workerBinding], attachments: [] });
	expect(child.taskId).toBeTruthy();
	expect(await new RhinoLaunchService(f.journal, f.registry, f.serviceOptions).launch(f.context, { requestId: "one" })).toEqual(results[0]);
	expect(f.spawn).toHaveBeenCalledTimes(1);
});

it("does not grant access until the matching process and document are ready", async () => {
	const f = fixture({ ready: false });
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("timed out");
	expect(f.journal.authorizationAdditions(f.context.taskId)).toEqual([]);
	await expect(f.service.launch(f.context, { requestId: "replacement" })).rejects.toThrow("unresolved");
	f.register(workerProcess, workerBinding, true);
	expect((await f.service.launch(f.context, { requestId: "one" })).binding).toEqual(workerBinding);
	expect(f.spawn).toHaveBeenCalledTimes(1);
});

it("rejects registration with a reused PID and another process start time", async () => {
	const f = fixture({ ready: false });
	f.spawn.mockImplementationOnce(async (_path, onSpawn) => {
		onSpawn(202); f.processes.set(202, workerProcess);
		f.register({ ...workerProcess, startIdentity: "wrong" }, workerBinding, true);
		return workerProcess;
	});
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("timed out");
	expect(f.journal.authorizationAdditions(f.context.taskId)).toEqual([]);
});

it("records process exit and never replays that request", async () => {
	const f = fixture();
	f.inspect.mockImplementation(async pid => pid === 101 ? sourceProcess : null);
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("exited");
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("exited");
	expect(f.spawn).toHaveBeenCalledTimes(1);
	expect(f.journal.snapshot().records.find(row => row.kind === "launch")?.state).toBe("failed");
});

it("cancels before spawning and grants no access after cancellation during startup", async () => {
	const f = fixture();
	f.controller.abort();
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("cancelled");
	expect(f.spawn).not.toHaveBeenCalled();
	const g = fixture();
	g.spawn.mockImplementationOnce(async (_path, onSpawn) => { onSpawn(202); g.controller.abort(); return workerProcess; });
	await expect(g.service.launch(g.context, { requestId: "one" })).rejects.toThrow("cancelled");
	expect(g.journal.authorizationAdditions(g.context.taskId)).toEqual([]);
	expect(g.journal.snapshot().records.find(row => row.kind === "launch")?.state).toBe("cancelled");
});

it("rechecks cancellation and host intent after executable inspection", async () => {
	const f = fixture({ allowsLaunch: async () => false });
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("stopping");
	expect(f.spawn).not.toHaveBeenCalled();
	const g = fixture();
	g.inspect.mockImplementationOnce(async () => { g.controller.abort(); return sourceProcess; });
	await expect(g.service.launch(g.context, { requestId: "one" })).rejects.toThrow("cancelled");
	expect(g.spawn).not.toHaveBeenCalled();
});

it("refuses children, inaccessible processes, ambiguous sources and changed source identities", async () => {
	const f = fixture();
	await expect(f.service.launch({ ...f.context, parentTaskId: "parent" }, { requestId: "one" })).rejects.toThrow("root");
	await expect(f.service.launch(f.context, { requestId: "one", lifecycleInstanceId: "private" })).rejects.toThrow("accessible");
	await expect(f.service.launch({ ...f.context, binding: null, accessibleBindings: [sourceBinding, workerBinding] }, { requestId: "one" })).rejects.toThrow("Choose");
	f.processes.set(101, { ...sourceProcess, startIdentity: "reused" });
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("changed");
	expect(f.spawn).not.toHaveBeenCalled();
});

it("records a failed spawn, and retains an unknown process outcome without replay", async () => {
	const f = fixture();
	f.spawn.mockRejectedValueOnce(new RhinoNotStartedError("ENOENT"));
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("ENOENT");
	expect(f.journal.snapshot().records.find(row => row.kind === "launch")?.state).toBe("failed");
	const g = fixture();
	g.spawn.mockImplementationOnce(async (_path, onSpawn) => { onSpawn(202); throw new Error("identity unavailable"); });
	await expect(g.service.launch(g.context, { requestId: "one" })).rejects.toThrow("identity unavailable");
	await expect(new RhinoLaunchService(g.journal, g.registry, g.serviceOptions).launch(g.context, { requestId: "one" })).rejects.toThrow("not confirmed");
	expect(g.spawn).toHaveBeenCalledTimes(1);
});

it("exposes the tool only to Windows roots and rejects conflicting request reuse", async () => {
	const f = fixture();
	expect(f.service.tools(f.context).map(tool => tool.name)).toEqual(["launchRhino"]);
	expect(f.service.tools({ ...f.context, parentTaskId: "parent" })).toEqual([]);
	const mac = fixture({ platform: "darwin" });
	expect(mac.service.tools(mac.context)).toEqual([]);
	await expect(mac.service.launch(mac.context, { requestId: "one" })).rejects.toThrow("macOS");
	await f.service.launch(f.context, { requestId: "one" });
	await expect(f.service.launch(f.context, { requestId: "one", lifecycleInstanceId: "source" })).rejects.toThrow("conflicts");
});

it("cannot grant authority when the journal task is cancelled during readiness inspection", async () => {
	const f = fixture();
	f.inspect.mockImplementation(async pid => {
		if (pid === 101) return sourceProcess;
		f.journal.requestCancellation(f.context.taskId, "cancel-fixture");
		return workerProcess;
	});
	await expect(f.service.launch(f.context, { requestId: "one" })).rejects.toThrow("cancelled");
	expect(f.journal.authorizationAdditions(f.context.taskId)).toEqual([]);
	expect(f.journal.snapshot().records.find(row => row.kind === "launch")?.state).toBe("cancelled");
});
