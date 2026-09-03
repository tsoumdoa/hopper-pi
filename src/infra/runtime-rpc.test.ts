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
import {
	RpcOutcomeUnknownError,
	RuntimeRpc,
	type RuntimeRpcTransport,
} from "./runtime-rpc.js";
import { Requester } from "./requester.js";

const LIFE = "life-runtime-1";

describe("RuntimeRpc", () => {
	it("returns Rhino's runtime status object unchanged", async () => {
		const snapshot = status("ready", true, 17);
		const transport = new FakeTransport((operation) => response(
			operation,
			operation === "lifecycleHandshake"
				? { handshake: "live", statusRevision: 17 }
				: snapshot,
		));
		const runtime = runtimeWith(transport, new FakeEvents());

		const result = await runtime.getRuntimeStatus();

		expect(result).toBe(snapshot);
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

	it("keeps an ambiguous mutation outcome Node-local", async () => {
		const snapshot = status("ready", true, 1);
		const unknown: NodeLocalOutcomeUnknown = {
			source: "node",
			lifecycleInstanceId: LIFE,
			requestId: "req-mutation",
			operation: "setSliderValue",
			operationId: "op-mutation",
			result: { class: "outcome_unknown", message: "reply lost" },
		};
		const transport = new FakeTransport((operation) => {
			if (operation === "lifecycleHandshake") {
				return response(operation, { handshake: "live", statusRevision: 1 });
			}
			if (operation === "getRuntimeStatus") return response(operation, snapshot);
			return unknown;
		});
		const runtime = runtimeWith(transport, new FakeEvents());

		try {
			await runtime.invoke("setSliderValue", { targetId: "slider-1", value: 4 });
			expect.fail("expected an unknown-outcome error");
		} catch (error) {
			expect(error).toBeInstanceOf(RpcOutcomeUnknownError);
			expect((error as RpcOutcomeUnknownError).outcome).toBe(unknown);
			expect((error as RpcOutcomeUnknownError).outcome.source).toBe("node");
		}
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
});

describe("Requester RPC v2 facade", () => {
	it("maps the existing domain request shape to an RPC operation and args", async () => {
		const request = vi.fn(async () => ({ type: "getCurrentCanvas.response" }));
		const requester = new Requester({ request } as unknown as RuntimeRpc);

		const result = await requester.request({
			type: "getCurrentCanvas",
			selectionOnly: true,
		});

		expect(request).toHaveBeenCalledWith("getCurrentCanvas", { selectionOnly: true });
		expect(result).toEqual({ type: "getCurrentCanvas.response" });
	});

	it("does not preserve the legacy ping operation as a fallback", async () => {
		const request = vi.fn();
		const requester = new Requester({ request } as unknown as RuntimeRpc);

		await expect(requester.request({ type: "ping" })).rejects.toThrow(
			"Unsupported RPC domain operation: ping",
		);
		expect(request).not.toHaveBeenCalled();
	});
});

function runtimeWith(transport: FakeTransport, events: FakeEvents): RuntimeRpc {
	return new RuntimeRpc({
		lifecycleInstanceId: LIFE,
		transport,
		events,
		nodeProcessId: 42,
		nodeVersion: "v22.19.0",
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

	async subscribe(onWakeup: () => void): Promise<() => void> {
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
