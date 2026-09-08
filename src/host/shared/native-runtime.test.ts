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
