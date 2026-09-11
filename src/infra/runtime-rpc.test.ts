import { describe, expect, it, vi } from "vitest";
import type {
	OperationName,
	RequestArgsFor,
	RpcOperationResponse,
	RuntimeStatus,
} from "../protocol/v2.js";
import type {
	NodeLocalOutcomeUnknown,
	RpcCallOptions,
	RpcCallResult,
} from "./rpc-client.js";
import type { RuntimeStatusEventSource } from "./grasshopper-readiness.js";
import { RpcOutcomeUnknownError, RuntimeRpc, type RuntimeRpcTransport } from "./runtime-rpc.js";
import { clearDocumentGuidAliases, resolveInstanceGuid, resolveRhinoGuid, toShortInstanceGuid, toShortRhinoGuid } from "../services/guid-shortener.js";

const LIFE = "life-runtime-1";

describe("RuntimeRpc", () => {
	it.each(["rhino", "grasshopper"] as const)("retains %s aliases across editing segments and clears them for another document", async (owner) => {
		clearDocumentGuidAliases(owner);
		const shorten = owner === "rhino" ? toShortRhinoGuid : toShortInstanceGuid;
		const resolve = owner === "rhino" ? resolveRhinoGuid : resolveInstanceGuid;
		const begin = owner === "rhino" ? "beginRhinoAgentTransaction" : "beginAgentTransaction";
		const commit = owner === "rhino" ? "commitRhinoAgentTransaction" : "commitAgentTransaction";
		let activeDocument = "doc-a";
		let segment = { documentId: null as string | null, segmentId: null as string | null, epoch: 0, state: "idle", lifecycleInstanceId: LIFE };
		const transport = new FakeTransport((operation) => {
			if (operation === "getRuntimeStatus") return response(operation, status("ready", true, 1));
			if (operation === begin) segment = { documentId: activeDocument, segmentId: `segment-${segment.epoch + 1}`, epoch: segment.epoch + 1, state: "active", lifecycleInstanceId: LIFE };
			if (operation === commit) segment = { documentId: null, segmentId: null, epoch: segment.epoch + 1, state: "idle", lifecycleInstanceId: LIFE };
			return response(operation, operation === "getDocumentTransactionState" ? segment : { transaction: segment });
		});
		const runtime = runtimeWith(transport, new FakeEvents());
		const full = "11111111-2222-3333-4444-555555555555";
		const alias = shorten(full);
		await runtime.invoke(begin, {});
		expect(resolve(alias)).toBe(full);
		await runtime.invoke(commit, {});
		expect(resolve(alias)).toBe(full);
		await runtime.invoke(begin, {});
		expect(resolve(alias)).toBe(full);
		await runtime.invoke(commit, {});
		activeDocument = "doc-b";
		await runtime.invoke(begin, {});
		expect(resolve(alias)).toBe(alias);
		await runtime.close();
		clearDocumentGuidAliases(owner);
	});

	it("rereads after a readiness reconnect and submits the original mutation once", async () => {
		const events = new FakeEvents();
		let statusReads = 0;
		const transport = new FakeTransport((operation) => {
			if (operation === "lifecycleHandshake") {
				return response(operation, { handshake: "live", statusRevision: 1 });
			}
			if (operation === "getRuntimeStatus") {
				statusReads++;
				return response(
					operation,
					statusReads < 3
						? status("loading", false, statusReads)
						: status("ready", true, statusReads),
				);
			}
			return response(operation, { changed: true }, "op-original");
		});
		const runtime = runtimeWith(transport, events);

		const pending = runtime.invoke("setSliderValue", { targetId: "slider-1", value: 4 });
		await vi.waitFor(() => expect(statusReads).toBe(2));
		events.emitReconnect();
		await expect(pending).resolves.toMatchObject({ operationId: "op-original" });

		expect(transport.calls.filter((call) => call.operation === "setSliderValue")).toHaveLength(1);
		expect(transport.calls.filter((call) => call.operation === "getRuntimeStatus")).toHaveLength(3);
	});

	it("does not submit a Grasshopper operation without an active document", async () => {
		const snapshot = status("ready", false, 1);
		const transport = new FakeTransport((operation) => {
			if (operation === "lifecycleHandshake") {
				return response(operation, { handshake: "live", statusRevision: 1 });
			}
			return response(operation, snapshot);
		});
		const runtime = runtimeWith(transport, new FakeEvents());

		await expect(runtime.invoke(
			"getCurrentCanvas",
			{},
		)).rejects.toMatchObject({ reasonCode: "NO_ACTIVE_GRASSHOPPER_DOCUMENT" });
		expect(transport.calls.some((call) => call.operation === "getCurrentCanvas")).toBe(false);
	});

	it("opens the Grasshopper transaction once on the first mutation", async () => {
		const snapshot = status("ready", true, 1);
		const transport = new FakeTransport((operation) => response(
			operation,
			operation === "lifecycleHandshake"
				? { handshake: "live", statusRevision: 1 }
				: operation === "getRuntimeStatus"
					? snapshot
					: {},
		));
		const runtime = runtimeWith(transport, new FakeEvents());

		runtime.beginAgentTurn();
		await runtime.invoke("setSliderValue", { targetId: "slider-1", value: 4 });
		await runtime.invoke("createPanel", { pivot: { x: 1, y: 2 } });
		await runtime.commitAgentTurn();

		const operations = transport.calls.map((call) => call.operation);
		expect(operations.filter((operation) => operation === "beginAgentTransaction")).toHaveLength(1);
		expect(operations.filter((operation) => operation === "commitAgentTransaction")).toHaveLength(1);
		expect(operations.indexOf("beginAgentTransaction")).toBeLessThan(operations.indexOf("setSliderValue"));
	});

	it("abandons stale local transaction ownership after a native document switch", async () => {
		let segment = { documentId: "doc-a", segmentId: "segment-a", epoch: 1, state: "active", lifecycleInstanceId: LIFE };
		const transport = new FakeTransport((operation) => response(operation,
			operation === "getDocumentTransactionState" ? segment : { transaction: segment }));
		const runtime = runtimeWith(transport, new FakeEvents());
		runtime.beginAgentTurn();
		await runtime.invoke("runRhinoScript", { mode: "python", source: "pass" });
		expect(transport.calls.find((call) => call.operation === "runRhinoScript")?.args).toMatchObject({ expectedSegment: { documentId: "doc-a", segmentId: "segment-a" } });
		segment = { ...segment, documentId: "doc-b", segmentId: "", state: "abandoned", epoch: 2 };
		await runtime.cancelAgentTurn();
		expect(transport.calls.some((call) => call.operation === "cancelRhinoAgentTransaction")).toBe(false);
	});

	it("blocks dependent edits and cancellation until an uncertain transition has a terminal result", async () => {
		let terminal = false;
		const segment = { documentId: "doc-b", segmentId: null, epoch: 2, state: "idle", lifecycleInstanceId: LIFE };
		const transport = new FakeTransport((operation) => {
			if (operation === "manageRhinoDocument") return {
				source: "node", protocolVersion: 2, lifecycleInstanceId: LIFE, requestId: "req-save", operation, operationId: "save-1",
				result: { class: "outcome_unknown", reasonCode: "COMPLETION_TIMEOUT", message: "Reply lost" },
			} as NodeLocalOutcomeUnknown;
			return response(operation, operation === "getOperationResult" ? { state: terminal ? "terminal" : "pending" }
				: operation === "getDocumentTransactionState" ? segment : {});
		});
		const runtime = runtimeWith(transport, new FakeEvents());
		runtime.beginAgentTurn();
		await expect(runtime.invoke("manageRhinoDocument", { action: "save", documentId: "doc-a", expectedStateToken: "v1" })).rejects.toBeInstanceOf(RpcOutcomeUnknownError);
		await expect(runtime.invoke("runRhinoScript", { mode: "python", source: "pass" })).rejects.toThrow("uncertain");
		await expect(runtime.cancelAgentTurn()).rejects.toThrow("uncertain");
		expect(transport.calls.some((call) => call.operation === "runRhinoScript" || call.operation === "cancelRhinoAgentTransaction")).toBe(false);
		terminal = true;
		await runtime.invoke("runRhinoScript", { mode: "python", source: "pass" });
		expect(transport.calls.filter((call) => call.operation === "manageRhinoDocument")).toHaveLength(1);
	});

	it("closes transport even when an uncertain mutation blocks cancellation", async () => {
		const transport = new FakeTransport((operation) => operation === "manageRhinoDocument" ? {
			source: "node", protocolVersion: 2, lifecycleInstanceId: LIFE, requestId: "req-save", operation, operationId: "save-1",
			result: { class: "outcome_unknown", reasonCode: "COMPLETION_TIMEOUT", message: "Reply lost" },
		} as NodeLocalOutcomeUnknown : response(operation, operation === "getOperationResult" ? { state: "pending" } : {}));
		const closed = vi.spyOn(transport, "close");
		const runtime = runtimeWith(transport, new FakeEvents());
		await expect(runtime.invoke("manageRhinoDocument", { action: "save", documentId: "doc-a", expectedStateToken: "v1" })).rejects.toBeInstanceOf(RpcOutcomeUnknownError);
		await expect(runtime.close()).rejects.toThrow("uncertain");
		expect(closed).toHaveBeenCalledOnce();
		expect(transport.calls.filter((call) => call.operation === "manageRhinoDocument")).toHaveLength(1);
		expect(transport.calls.some((call) => call.operation === "cancelRhinoAgentTransaction")).toBe(false);
	});
});


function runtimeWith(
	transport: FakeTransport,
	events: FakeEvents,
	handshakeRetry?: ConstructorParameters<typeof RuntimeRpc>[0]["handshakeRetry"],
): RuntimeRpc {
	return new RuntimeRpc({
		lifecycleInstanceId: LIFE,
		transport,
		events,
		nodeProcessId: 42,
		nodeVersion: "v22.19.0",
		handshakeRetry,
	});
}

class FakeTransport implements RuntimeRpcTransport {
	readonly identity = "node-test-1";
	readonly calls: Array<{ operation: OperationName; args: unknown }> = [];

	constructor(private readonly handler: (operation: OperationName) => RpcCallResult) { }

	async connect(): Promise<void> { }
	async close(): Promise<void> { }

	async call<O extends OperationName>(
		operation: O,
		args: RequestArgsFor<O>,
		_options?: RpcCallOptions,
	): Promise<RpcCallResult> {
		this.calls.push({ operation, args });
		return this.handler(operation);
	}
}

class FakeEvents implements RuntimeStatusEventSource {
	private listener: (() => void) | null = null;
	subscribeCount = 0;

	async subscribe(onWakeup: () => void): Promise<() => void> {
		this.subscribeCount++;
		this.listener = onWakeup;
		return () => { this.listener = null; };
	}

	emitReconnect(): void {
		this.listener?.();
	}
}

function response(
	operation: OperationName,
	data: unknown,
	operationId?: string,
): RpcOperationResponse {
	return {
		protocolVersion: 2,
		lifecycleInstanceId: LIFE,
		requestId: `req-${operation}`,
		operation,
		...(operationId ? { operationId } : {}),
		result: { class: "completed", reasonCode: "OK", data: data as never },
	};
}

function status(
	grasshopperState: RuntimeStatus["grasshopper"]["state"],
	activeDocument: boolean,
	revision: number,
): RuntimeStatus {
	return {
		protocolVersion: 2,
		revision,
		observedAt: revision,
		lifecycle: { state: "running", changedAt: 1, reason: null },
		transport: { ready: true, lifecycleInstanceId: LIFE },
		host: {
			state: "running",
			processId: 42,
			nodePath: "/usr/local/bin/node",
			nodeVersion: "22.19.0",
			handshake: "live",
			healthFailureCount: 0,
		},
		rhino: { activeDocument: true, documentName: "model.3dm" },
		grasshopper: {
			state: grasshopperState,
			activeDocument,
			documentName: activeDocument ? "definition.gh" : null,
		},
		dispatcher: { acceptingExternalWork: true, depth: 0, capacity: 64 },
		errors: { transport: null, host: null, rhino: null, grasshopper: null, dispatcher: null },
	};
}
