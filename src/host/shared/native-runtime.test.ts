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
								documents: [{ documentId: "doc", stateToken: "observed" }],
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
		ask: () => "question",
		requestDocumentAction: () => "handoff",
		publish: () => {},
	};
	const geometry = await runtime.geometry(context);
	geometry.runtimeSession.options.createRuntime!();
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
	await expect(geometry.cleanup()).resolves.toMatchObject({
		confirmed: false,
		evidence: { scopes: [{ state: "active" }, { state: "active" }] },
	});
	expect(wire.closeRuntime).toHaveBeenCalledTimes(1);
	expect(wire.close).not.toHaveBeenCalled();
	wire.call.mockImplementation(normal);
	const transport = wire.transports.at(-1);
	registry.updateDocuments("life", []);
	await expect(transport.call("queryRhinoObjects", {})).rejects.toThrow(
		"closed",
	);
	await expect(
		transport.call("commitRhinoAgentTransaction", {}),
	).resolves.toMatchObject({ result: { class: "completed" } });
	const attachment = registry.list()[0]!;
	registry.register({ ...attachment, attachmentGeneration: "replacement" });
	await expect(
		transport.call("cancelRhinoAgentTransaction", {}),
	).rejects.toThrow("generation changed");
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
			data: { documents: [{ documentId: "stale-doc" }] },
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
			data: { documents: [{ documentId: "doc" }] },
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
							documents: [{ documentId: "doc", stateToken: "observed" }],
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


it("commits the main task before yielding its process and reactivates the same document on resume", async () => {
	const { journal, registry, runtime } = await setup();
	const binding: TargetBinding = { kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: "doc" };
	journal.registerSession("conversation", "session");
	const root = journal.accept({ requestId: "root", conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Edit", bindings: [binding], messageTarget: binding, attachments: [] });
	const owner = { taskId: root.taskId, turnId: root.turnId, binding, attachmentGeneration: "generation" };
	journal.start(root.taskId, root.turnId, owner);
	const geometry = await runtime.geometry({ taskId: root.taskId, turnId: root.turnId, owner, signal: new AbortController().signal } as DriverContext);
	geometry.runtimeSession.options.createRuntime!();
	const transport = wire.transports.at(-1);
	await expect(geometry.pause()).resolves.toMatchObject({ confirmed: true });
	expect(wire.commitRuntime).toHaveBeenCalledTimes(1);
	expect(wire.commitRuntime.mock.invocationCallOrder[0]).toBeLessThan(wire.closeRuntime.mock.invocationCallOrder[0]!);
	await expect(transport.call("queryRhinoObjects", {})).rejects.toThrow("paused");
	await expect(transport.call("runRhinoScript", {})).rejects.toThrow("paused");
	const normal = wire.call.getMockImplementation()!;
	let activeDocumentId = "other-document";
	wire.call.mockImplementation(async (operation: string, ...args: any[]) => {
		if (operation === "manageRhinoDocument" && args[0]?.action === "activate") activeDocumentId = args[0].documentId;
		const response = await normal(operation, ...args);
		if (operation === "listRhinoDocuments") response.result.data.activeDocumentId = activeDocumentId;
		return response;
	});
	await geometry.resume();
	expect(wire.call).toHaveBeenCalledWith("manageRhinoDocument", expect.objectContaining({ action: "activate", documentId: "doc" }), expect.anything());
	expect(wire.beginRuntime).toHaveBeenCalledTimes(1);
	await expect(transport.call("queryRhinoObjects", {})).resolves.toMatchObject({ result: { class: "completed" } });
	await geometry.pause();
	registry.updateDocuments("life", []);
	await expect(geometry.resume()).rejects.toThrow("closed");
	wire.call.mockClear();
	await expect(geometry.cleanup()).resolves.toMatchObject({ confirmed: true });
	// A paused task no longer owns this process and cannot clean up another task's scope.
	expect(wire.call).not.toHaveBeenCalled();
});
