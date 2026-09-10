import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedNativeRuntime } from "./native-runtime.js";
import type { DriverContext } from "./task-service.js";
import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";

const wire = vi.hoisted(() => ({
	call: vi.fn(),
	close: vi.fn(),
	closeRuntime: vi.fn(),
	commitRuntime: vi.fn(),
	beginRuntime: vi.fn(),
	transports: [] as any[],
	clients: 0,
	life: "life",
}));
vi.mock("../../infra/connection.js", () => ({
	resolveConnection: () => ({
		rpcEndpoint: "tcp://127.0.0.1:50101",
		pubEndpoint: "tcp://127.0.0.1:50102",
		lifecycleInstanceId: wire.life,
		token: "secret",
	}),
}));
vi.mock("../../infra/rpc-client.js", () => ({
	HopperRpcClient: class {
		constructor() {
			wire.clients++;
		}
		identity = "client";
		connect = async () => {};
		call = (...args: any[]) => wire.call(...args);
		close = async () => {
			wire.close();
		};
	},
}));
vi.mock("../../infra/runtime-rpc.js", () => ({
	closeRuntimeRpc: () => wire.closeRuntime(),
	commitRuntimeAgentTurn: () => wire.commitRuntime(),
	beginRuntimeAgentTurn: () => wire.beginRuntime(),
	RuntimeRpc: class {
		constructor(options: any) {
			wire.transports.push(options.transport);
		}
	},
}));
vi.mock("../../infra/status-event-source.js", () => ({
	SubscriberStatusEventSource: class {},
}));
const journals: TaskJournal[] = [];
afterEach(() => {
	for (const journal of journals.splice(0)) journal.close();
});
beforeEach(() => {
	wire.call.mockReset();
	wire.close.mockReset();
	wire.closeRuntime.mockReset();
	wire.commitRuntime.mockReset();
	wire.beginRuntime.mockReset();
	wire.transports.length = 0;
	wire.clients = 0;
	wire.life = "life";
	wire.call.mockImplementation(async (operation: string) => ({
		operation,
		result: {
			class: "completed",
			reasonCode: "OK",
			data:
				operation === "lifecycleHandshake"
					? { attachmentGeneration: "generation" }
					: operation === "listRhinoDocuments"
						? {
								documents: [{ documentId: "doc", stateToken: "observed", hopperInitialized: true }],
								activeDocumentId: "doc",
							}
						: operation === "listGrasshopperDocuments"
							? { documents: [] }
							: operation === "getDocumentTransactionState"
								? { state: "idle" }
								: {},
		},
	}));
});
async function setup(ready = true) {
	const journal = new TaskJournal(":memory:");
	journals.push(journal);
	const registry = new SharedRegistry(journal),
		runtime = new SharedNativeRuntime("epoch", registry, journal, () => true);
	await runtime.register({
		profilePath: "/profile.json",
		hostEpoch: "epoch",
		process: { pid: 123, startIdentity: "start" },
	});
	if (ready) await runtime.refresh();
	return { journal, registry, runtime };
}
it.each(["settings", "top-level"])("exposes initialized documents and their Grasshopper targets with %s associations", async (association) => {
	const { registry, runtime } = await setup();
	let initialized = false;
	let closed = false;
	const normal = wire.call.getMockImplementation()!;
	wire.call.mockImplementation(async (operation: string, ...args: any[]) => {
		if (operation === "listRhinoDocuments") return { operation, result: { class: "completed", data: {
			documents: [
				{ documentId: "doc", name: "Untitled 1", hopperInitialized: true },
				...(!closed ? [{ documentId: "doc-2", name: "Untitled 2", hopperInitialized: initialized }] : []),
			], activeDocumentId: "doc-2",
		} } };
		if (operation === "listGrasshopperDocuments") return { operation, result: { class: "completed", data: {
			documents: [{ documentId: "gh-2", ...(association === "settings" ? { settings: { associatedRhinoDocumentId: "doc-2" } } : { associatedRhinoDocumentId: "doc-2" }) }],
		} } };
		return normal(operation, ...args);
	});
	await runtime.refresh();
	expect(registry.list()[0]!.documents).toEqual([{ kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: "doc" }]);
	expect(registry.list()[0]!.documentLabels).not.toHaveProperty("doc-2");
	// Running HopperCode in the second document changes metadata, without reconnecting the process.
	initialized = true;
	await runtime.refresh();
	expect(registry.list()[0]!.documents).toHaveLength(3);
	expect(registry.list()[0]!.documentLabels!["doc-2"]).toBe("Untitled 2");
	expect(wire.clients).toBe(1);
	closed = true;
	await runtime.refresh();
	expect(registry.list()[0]!.documents).toHaveLength(1);
});
it.each([undefined, null, false, "true"])("does not advertise a document with initialization metadata %s", async (hopperInitialized) => {
	const { registry, runtime } = await setup();
	const normal = wire.call.getMockImplementation()!;
	wire.call.mockImplementation(async (operation: string, ...args: any[]) => {
		if (operation === "listRhinoDocuments") return { result: { class: "completed", data: {
			documents: [
				{ documentId: "doc", hopperInitialized: true },
				{ documentId: "not-initialized", hopperInitialized },
			], activeDocumentId: "not-initialized",
		} } };
		return normal(operation, ...args);
	});
	await runtime.refresh();
	expect(registry.list()[0]!.documents).toEqual([{ kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: "doc" }]);
	expect(registry.list()[0]!.documentLabels).not.toHaveProperty("not-initialized");
});
it("recovers a transient document-query outage without requiring plugin restart", async () => {
	const { registry, runtime } = await setup();
	wire.call.mockRejectedValueOnce(new Error("UI queue busy"));
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("recovering");
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("ready");
});
it("does not reopen admission while recovered native scopes remain active", async () => {
	const { registry, runtime } = await setup();
	wire.call.mockRejectedValueOnce(new Error("temporarily disconnected"));
	await runtime.refresh();
	const normal = wire.call.getMockImplementation()!;
	wire.call.mockImplementation(async (operation: string, ...args: any[]) =>
		operation === "getDocumentTransactionState"
			? {
					operation,
					result: {
						class: "completed",
						reasonCode: "OK",
						data: { state: "active" },
					},
				}
			: normal(operation, ...args),
	);
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("recovering");
});
it("permits exact-generation cleanup after document drift while rejecting new geometry", async () => {
	const { journal, registry, runtime } = await setup();
	const binding: TargetBinding = {
		kind: "rhino",
		lifecycleInstanceId: "life",
		rhinoDocumentId: "doc",
	};
	journal.registerSession("conversation", "session");
	const receipt = journal.accept({
		requestId: "request",
		conversationId: "conversation",
		sessionId: "session",
		kind: "prompt",
		text: "edit",
		bindings: [binding],
		attachments: [],
	});
	const owner: ExecutionOwner = {
		taskId: receipt.taskId,
		turnId: receipt.turnId,
		binding,
		attachmentGeneration: "generation",
	};
	journal.start(receipt.taskId, receipt.turnId, owner);
	const context: DriverContext = {
		taskId: receipt.taskId,
		turnId: receipt.turnId,
		sessionId: "session",
		conversationId: "conversation",
		binding,
		owner,
		text: "edit",
		attachments: [],
		continuation: null,
		signal: new AbortController().signal,
		withNativeTool: async (work) => work(),
		ask: () => "question",
		requestDocumentAction: () => "handoff",
		publish: () => {},
	};
	const geometry = await runtime.geometry(context);
	geometry.runtimeSession.options.createRuntime!();
	const transport = wire.transports.at(-1);
	await expect(transport.call("queryRhinoObjects", {})).rejects.toThrow("tool execution lease");
	await geometry.runTool("edit", async () => {
		registry.updateDocuments("life", []);
		await expect(transport.call("queryRhinoObjects", {})).rejects.toThrow("closed");
		await expect(transport.call("commitRhinoAgentTransaction", {})).resolves.toMatchObject({ result: { class: "completed" } });
		const attachment = registry.list()[0]!;
		registry.register({ ...attachment, attachmentGeneration: "replacement" });
		await expect(transport.call("cancelRhinoAgentTransaction", {})).rejects.toThrow("generation changed");
	});
	expect(wire.closeRuntime).toHaveBeenCalledTimes(1);
	expect(wire.close).not.toHaveBeenCalled();

});

it("returns handshake-only admission before native startup opens the UI queue", async () => {
	const { registry, runtime } = await setup(false);
	expect(wire.call.mock.calls.map((call) => call[0])).toEqual([
		"lifecycleHandshake",
	]);
	expect(registry.list()[0]!.admission).toBe("recovering");
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("ready");
});
it("serializes duplicate registration so retries retain one native DEALER route", async () => {
	const journal = new TaskJournal(":memory:");
	journals.push(journal);
	const registry = new SharedRegistry(journal),
		runtime = new SharedNativeRuntime("epoch", registry, journal, () => true);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const normal = wire.call.getMockImplementation()!;
	wire.call.mockImplementationOnce(async (...args) => {
		await gate;
		return normal(...args);
	});
	const input = {
		profilePath: "/profile.json",
		hostEpoch: "epoch",
		process: { pid: 123, startIdentity: "start" },
	};
	const first = runtime.register(input);
	const second = runtime.register(input);
	await vi.waitFor(() => expect(wire.call).toHaveBeenCalledTimes(1));
	expect(wire.clients).toBe(1);
	release();
	const results = await Promise.all([first, second]);
	expect(results[0]).toEqual(results[1]);
	expect(wire.clients).toBe(1);
	expect(wire.close).not.toHaveBeenCalled();
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("ready");
});

it("reserves bound saves durably and rejects target changes or coordinator transitions", async () => {
	const root = await mkdtemp(join(tmpdir(), "bound-save-"));
	try {
		const { journal, runtime } = await setup();
		const binding: TargetBinding = {
			kind: "rhino",
			lifecycleInstanceId: "life",
			rhinoDocumentId: "doc",
		};
		journal.registerSession("conversation", "session");
		const receipt = journal.accept({
			requestId: "save-request",
			conversationId: "conversation",
			sessionId: "session",
			kind: "prompt",
			text: "save",
			bindings: [binding],
			attachments: [],
		});
		const owner: ExecutionOwner = {
			taskId: receipt.taskId,
			turnId: receipt.turnId,
			binding,
			attachmentGeneration: "generation",
		};
		journal.start(receipt.taskId, receipt.turnId, owner);
		const geometry = await runtime.geometry({
			taskId: receipt.taskId,
			turnId: receipt.turnId,
			sessionId: "session",
			conversationId: "conversation",
			binding,
			owner,
			text: "save",
			attachments: [],
			continuation: null,
			signal: new AbortController().signal,
			withNativeTool: async (work) => work(),
			ask: () => "q",
			requestDocumentAction: () => "h",
			publish: () => {},
		});
		geometry.runtimeSession.options.createRuntime!();
		const transport = wire.transports.at(-1);
		const normal = wire.call.getMockImplementation()!;
		wire.call.mockImplementation(
			async (operation: string, args: any, options: any) => {
				if (operation === "listRhinoDocuments")
					return {
						result: {
							class: "completed",
							data: {
								activeDocumentId: "doc",
								documents: [
									{
										documentId: "doc",
										stateToken: "observed",
										path: null,
										isModified: true,
									},
								],
							},
						},
					};
				if (operation === "manageRhinoDocument") {
					expect(options.executionOwner).toEqual(owner);
					expect(args.expectedDestinations).toMatchObject([{ exists: false }]);
					expect(journal.snapshot().reservations).toHaveLength(1);
					return {
						result: {
							class: "completed",
							data: { ok: false, outcomeUncertain: true },
						},
					};
				}
				return normal(operation, args, options);
			},
		);
		await geometry.runTool("save", async () => {
			await expect(
				transport.call("manageRhinoDocument", {
					action: "open",
					path: join(root, "target.3dm"),
				}),
			).rejects.toThrow("coordinator");
			await expect(
				transport.call("manageRhinoDocument", {
					action: "close",
					documentId: "other",
					expectedStateToken: "observed",
				}),
			).rejects.toThrow("captured binding");
			await expect(
				transport.call("manageRhinoDocument", {
					action: "saveAs",
					documentId: "doc",
					expectedStateToken: "old",
					path: join(root, "target.3dm"),
				}),
			).rejects.toThrow("changed");
			await transport.call("manageRhinoDocument", {
				action: "saveAs",
				documentId: "doc",
				expectedStateToken: "observed",
				path: join(root, "target.3dm"),
			});
			expect(journal.snapshot().operations).toMatchObject([
				{ state: "uncertain" },
			]);
			expect(journal.snapshot().reservations).toHaveLength(1);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("detaches verified dead native processes without querying their stalled transport", async () => {
	const journal = new TaskJournal(":memory:");
	journals.push(journal);
	const registry = new SharedRegistry(journal);
	const runtime = new SharedNativeRuntime(
		"epoch",
		registry,
		journal,
		() => false,
	);
	await runtime.register({
		profilePath: "/profile.json",
		hostEpoch: "epoch",
		process: { pid: 123, startIdentity: "start" },
	});
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("detached");
	expect(wire.call).toHaveBeenCalledTimes(1);
	expect(wire.close).toHaveBeenCalledTimes(1);
});
it("ignores stale inventory after a newer same-lifecycle registration", async () => {
	const { registry, runtime } = await setup();
	let release!: (value: any) => void;
	wire.call.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = runtime.refresh();
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await runtime.register({
		profilePath: "/profile.json",
		hostEpoch: "epoch",
		process: { pid: 123, startIdentity: "start" },
	});
	release({
		result: {
			class: "completed",
			data: { documents: [{ documentId: "stale-doc", hopperInitialized: true }] },
		},
	});
	await pending;
	expect(registry.list()[0]!.documents).toEqual([]);
	expect(registry.list()[0]!.admission).toBe("recovering");
});

it("refreshes healthy lifecycles while a different native UI query is stalled", async () => {
	const { registry, runtime } = await setup();
	wire.life = "second";
	await runtime.register({
		profilePath: "/second.json",
		hostEpoch: "epoch",
		process: { pid: 456, startIdentity: "second" },
	});
	let release!: (value: any) => void;
	wire.call.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = runtime.refresh();
	await vi.waitFor(() =>
		expect(
			registry.list().find((item) => item.lifecycleInstanceId === "second")!
				.admission,
		).toBe("ready"),
	);
	const inventoryCalls = wire.call.mock.calls.filter((call) =>
		[
			"listRhinoDocuments",
			"listGrasshopperDocuments",
			"getDocumentTransactionState",
		].includes(call[0]),
	);
	expect(
		inventoryCalls.every((call) => call[2]?.completionTimeoutMs === 3000),
	).toBe(true);
	release({
		result: {
			class: "completed",
			data: { documents: [{ documentId: "doc", hopperInitialized: true }] },
		},
	});
	await pending;
});
it("allows readiness after an explicit recovery disposition without rewriting unknown operations", async () => {
	const { registry, runtime, journal } = await setup();
	const binding: TargetBinding = {
		kind: "rhino",
		lifecycleInstanceId: "life",
		rhinoDocumentId: "doc",
	};
	journal.registerSession("conversation", "session");
	const receipt = journal.accept({
		requestId: "recover",
		conversationId: "conversation",
		sessionId: "session",
		kind: "prompt",
		text: "edit",
		bindings: [binding],
		attachments: [],
	});
	const owner: ExecutionOwner = {
		taskId: receipt.taskId,
		turnId: receipt.turnId,
		binding,
		attachmentGeneration: "generation",
	};
	journal.start(receipt.taskId, receipt.turnId, owner);
	const operation = journal.operationIntent({
		taskId: receipt.taskId,
		turnId: receipt.turnId,
		name: "runRhinoScript",
		operationClass: "mutation",
		arguments: {},
		owner,
		deadline: Date.now() + 1000,
	});
	journal.operationResult(operation.id, "uncertain", {});
	journal.markScopeUncertain(owner, receipt.taskId, receipt.turnId, {});
	journal.uncertain(receipt.taskId, receipt.turnId, {});
	registry.register(registry.list()[0]!);
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("recovering");
	journal.recoveryDisposition("ack", receipt.taskId, {
		acknowledged: true,
		authenticatedAndFenced: true,
		operationsIdle: true,
		scopesIdle: true,
		inspectedBaseline: {},
	});
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("ready");
	expect(journal.snapshot().operations[0]!.state).toBe("uncertain");
});

it("retains human document labels and the native Grasshopper associated Rhino identity", async () => {
	const { registry, runtime } = await setup(false);
	const normal = wire.call.getMockImplementation()!;
	wire.call.mockImplementation(async (operation: string, ...args: any[]) =>
		operation === "listGrasshopperDocuments"
			? {
					result: {
						class: "completed",
						data: {
							documents: [
								{
									documentId: "gh",
									name: "Definition",
									path: "/models/definition.gh",
									settings: { associatedRhinoDocumentId: "doc" },
								},
							],
						},
					},
				}
			: normal(operation, ...args),
	);
	await runtime.refresh();
	const attachment = registry.list()[0]!;
	expect(attachment.documents).toContainEqual({
		kind: "grasshopper",
		lifecycleInstanceId: "life",
		grasshopperDocumentId: "gh",
		associatedRhinoDocumentId: "doc",
	});
	expect(attachment.documentLabels?.gh).toContain("Definition");
	expect(attachment.documentLabels?.gh).toContain("/models/definition.gh");
});

it("activates only the captured inactive document before geometry initialization", async () => {
	const { runtime, journal } = await setup();
	const binding: TargetBinding = {
		kind: "rhino",
		lifecycleInstanceId: "life",
		rhinoDocumentId: "doc",
	};
	journal.registerSession("conversation", "session");
	const receipt = journal.accept({
		requestId: "activate",
		conversationId: "conversation",
		sessionId: "session",
		kind: "prompt",
		text: "edit",
		bindings: [binding],
		attachments: [],
	});
	const owner: ExecutionOwner = {
		taskId: receipt.taskId,
		turnId: receipt.turnId,
		binding,
		attachmentGeneration: "generation",
	};
	journal.start(receipt.taskId, receipt.turnId, owner);
	const normal = wire.call.getMockImplementation()!;
	let active = "other";
	wire.call.mockImplementation(
		async (operation: string, args: any, options: any) => {
			if (operation === "listRhinoDocuments")
				return {
					result: {
						class: "completed",
						data: {
							activeDocumentId: active,
							documents: [{ documentId: "doc", stateToken: "observed", hopperInitialized: true }],
						},
					},
				};
			if (operation === "manageRhinoDocument") {
				expect(args).toEqual({
					action: "activate",
					documentId: "doc",
					expectedStateToken: "observed",
					expectedActiveDocument: "other",
					expectedDestinations: [],
				});
				expect(options.executionOwner).toEqual(owner);
				active = "doc";
				return { result: { class: "completed", data: { ok: true } } };
			}
			return normal(operation, args, options);
		},
	);
	await runtime.activateBinding(owner);
	expect(active).toBe("doc");
	expect(journal.snapshot().operations).toMatchObject([
		{ name: "manageRhinoDocument", state: "completed" },
	]);
	await runtime.activateBinding(owner);
	expect(journal.snapshot().operations).toHaveLength(1);
});

it("keeps an issued owner valid through busy-UI recovery while blocking new admission", async () => {
	const { registry, runtime } = await setup();
	const binding: TargetBinding = {
		kind: "rhino",
		lifecycleInstanceId: "life",
		rhinoDocumentId: "doc",
	};
	const owner: ExecutionOwner = {
		taskId: "task",
		turnId: "turn",
		binding,
		attachmentGeneration: "generation",
	};
	wire.call.mockRejectedValueOnce(
		new Error("Native UI running a long operation"),
	);
	await runtime.refresh();
	expect(registry.list()[0]!.admission).toBe("recovering");
	expect(() => registry.resolveBinding(binding)).toThrow("recovering");
	expect(() => registry.validateBinding(owner)).not.toThrow();
	expect(() =>
		registry.validateBinding({ ...owner, attachmentGeneration: "stale" }),
	).toThrow("generation");
	registry.detach("life");
	expect(() => registry.validateBinding(owner)).toThrow("detached");
});

it("detaches dead persisted attachments without pruning live unconnected processes", async () => {
	const journal = new TaskJournal(":memory:");
	journals.push(journal);
	const registry = new SharedRegistry(journal);
	const base = {
		hostEpoch: "old",
		attachmentGeneration: "old-generation",
		capabilities: [],
		documents: [],
		admission: "recovering" as const,
		label: "Rhino",
	};
	registry.register({
		...base,
		lifecycleInstanceId: "dead",
		processId: 1,
		processStartTime: "dead-start",
	});
	registry.register({
		...base,
		lifecycleInstanceId: "alive",
		processId: 2,
		processStartTime: "alive-start",
	});
	const runtime = new SharedNativeRuntime(
		"epoch",
		registry,
		journal,
		(pid) => pid === 2,
	);
	await runtime.refresh();
	expect(
		registry.list().find((item) => item.lifecycleInstanceId === "dead")!
			.admission,
	).toBe("detached");
	expect(
		registry.list().find((item) => item.lifecycleInstanceId === "alive")!
			.admission,
	).toBe("recovering");
	expect(wire.call).not.toHaveBeenCalled();
});

it("replaces a stale attachment in the same process after a new lifecycle authenticates", async () => {
	const { registry, runtime } = await setup();
	wire.life = "replacement";
	await runtime.register({ profilePath: "/replacement.json", hostEpoch: "epoch", process: { pid: 123, startIdentity: "start" } });
	expect(registry.list().find((target) => target.lifecycleInstanceId === "life")!.admission).toBe("detached");
	expect(wire.close).toHaveBeenCalledTimes(1);
	await runtime.refresh();
	const targets = registry.list().filter((target) => target.admission === "ready");
	expect(targets.map((target) => target.lifecycleInstanceId)).toEqual(["replacement"]);
	expect(targets[0]!.documents[0]!.lifecycleInstanceId).toBe("replacement");
});

it("keeps other Hopper instances attached when one process replaces its lifecycle", async () => {
	const { registry, runtime } = await setup();
	wire.life = "second";
	await runtime.register({ profilePath: "/second.json", hostEpoch: "epoch", process: { pid: 456, startIdentity: "second-start" } });
	wire.life = "replacement";
	await runtime.register({ profilePath: "/replacement.json", hostEpoch: "epoch", process: { pid: 123, startIdentity: "start" } });
	await runtime.refresh();
	expect(registry.list().filter((target) => target.admission === "ready").map((target) => target.lifecycleInstanceId)).toEqual(["second", "replacement"]);
	const restricted = registry.accessibleTargets([{ rhinoDocumentId: "doc", lifecycleInstanceId: "second", kind: "rhino" }]);
	expect(restricted.map((target) => target.lifecycleInstanceId)).toEqual(["second"]);
});

it("does not retire a current attachment when its proposed replacement fails authentication", async () => {
	const { registry, runtime } = await setup();
	wire.life = "replacement";
	wire.call.mockRejectedValueOnce(new Error("Handshake rejected"));
	await expect(runtime.register({ profilePath: "/replacement.json", hostEpoch: "epoch", process: { pid: 123, startIdentity: "start" } })).rejects.toThrow("Handshake rejected");
	expect(registry.list().map((target) => [target.lifecycleInstanceId, target.admission])).toEqual([["life", "ready"]]);
});

it("keeps the original host while any Rhino process survives and stops only after the last exit", async () => {
	const journal = new TaskJournal(":memory:"); journals.push(journal);
	const registry = new SharedRegistry(journal);
	const alive = new Set<number>([123, 456]);
	const runtime = new SharedNativeRuntime("epoch", registry, journal, (pid) => alive.has(pid));
	const now = Date.now();
	expect(runtime.shouldStopAfterRhinoExit(now + 59_000)).toBe(false);
	expect(runtime.shouldStopAfterRhinoExit(now + 61_000)).toBe(true);
	for (const pid of alive) {
		wire.life = String(pid);
		await runtime.register({ profilePath: `/${pid}.json`, hostEpoch: "epoch", process: { pid, startIdentity: `start-${pid}` } });
	}
	alive.delete(123); // The Rhino that started Node exits first.
	await runtime.refresh();
	expect(runtime.shouldStopAfterRhinoExit(now + 70_000)).toBe(false);
	// Even an explicit transport detach does not mean the second Rhino exited.
	await runtime.register({ action: "detach", lifecycleInstanceId: "456", hostEpoch: "epoch" });
	expect(runtime.shouldStopAfterRhinoExit(now + 80_000)).toBe(false);
	alive.clear();
	expect(runtime.shouldStopAfterRhinoExit(now + 84_000)).toBe(false);
	alive.add(789); // Another Rhino registers during the grace period.
	wire.life = "789";
	await runtime.register({ profilePath: "/789.json", hostEpoch: "epoch", process: { pid: 789, startIdentity: "start-789" } });
	expect(runtime.shouldStopAfterRhinoExit(now + 84_000)).toBe(false);
	alive.clear();
	expect(runtime.shouldStopAfterRhinoExit(now + 88_000)).toBe(false);
	expect(runtime.shouldStopAfterRhinoExit(now + 89_000)).toBe(true);
	await runtime.close();
});

it("keeps one conversation session across overlapping Rhino lifetimes and resets after every process exits", async () => {
	const journal = new TaskJournal(":memory:"); journals.push(journal);
	let registry = new SharedRegistry(journal);
	const alive = new Set<number>([123]);
	let runtime = new SharedNativeRuntime("epoch", registry, journal, (pid) => alive.has(pid));
	const attach = async (life: string, pid: number, startIdentity: string) => {
		wire.life = life;
		alive.add(pid);
		await runtime.register({ profilePath: `/${life}.json`, hostEpoch: "epoch", process: { pid, startIdentity } });
	};
	await attach("first", 123, "first-start");
	const session = registry.conversationSession;
	const conversation = journal.createConversation("old", "Existing work");
	await attach("second", 456, "second-start");
	expect(registry.conversationSession).toEqual(session);
	// A missed detach or a host restart is not proof that Rhino exited.
	await runtime.close();
	registry = new SharedRegistry(journal);
	runtime = new SharedNativeRuntime("epoch", registry, journal, (pid) => alive.has(pid));
	await attach("first-reconnected", 123, "first-start");
	expect(registry.conversationSession).toEqual(session);
	alive.delete(123);
	await runtime.refresh();
	await attach("third", 789, "third-start");
	expect(registry.conversationSession).toEqual(session);
	// Quit and relaunch before the next poll. Even a reused PID starts a new session.
	alive.clear();
	await attach("new-session", 789, "new-start");
	const next = registry.conversationSession;
	expect(next.id).not.toBe(session.id);
	expect(next.afterConversationSequence).toBe(journal.lastConversationSequence);
	const stored = new SharedRegistry(journal);
	expect(stored.conversationSession).toEqual(next);
	expect(journal.snapshot().conversations[0]!.id).toBe(conversation.conversationId);
	await runtime.close();
});
