import assert from "node:assert/strict";
import { test } from "vitest";
import type { JsonValue } from "../core/contracts.js";
import { HopperCoreError } from "../core/errors.js";
import { mapTransportError } from "./transport-errors.js";
import type { RequestOptions } from "../infra/requester.js";
import type { WireRequest, WireResponse } from "./wire.js";
import type { ProtocolRequester } from "./backend-client.js";

type CapturedRequest = {
	request: WireRequest<string, import("../core/contracts.js").JsonObject>;
	options: RequestOptions;
};

function fakeRequester(handler: {
	response?: WireResponse<JsonValue> | ((request: CapturedRequest) => WireResponse<JsonValue>);
	error?: Error;
}): ProtocolRequester & { captured: CapturedRequest[]; connected: number; closed: number } {
	const captured: CapturedRequest[] = [];
	const fake = {
		connected: 0,
		closed: 0,
		captured,
		async connect() {
			fake.connected += 1;
		},
		async close() {
			fake.closed += 1;
		},
		async request<T extends JsonValue>(
			request: WireRequest<string, import("../core/contracts.js").JsonObject>,
			options: RequestOptions,
		): Promise<WireResponse<T>> {
			const entry = { request, options };
			captured.push(entry);
			if (handler.error) throw handler.error;
			const response = typeof handler.response === "function"
				? handler.response(entry)
				: handler.response!;
			return response as unknown as WireResponse<T>;
		},
	};
	return fake;
}

function wireResponse(overrides: Partial<WireResponse<JsonValue>> = {}): WireResponse<JsonValue> {
	return {
		protocolVersion: 1,
		type: "getBackendInfo",
		requestId: "req_01M0000000000000000000000",
		backend: {
			backendId: "be_x",
			backendStartedAt: "2026-08-15T00:00:00.000Z",
			pluginVersion: "1.0.0",
			protocolVersion: 1,
		},
		documents: null,
		outcome: "succeeded",
		startedAt: null,
		completedAt: null,
		data: null,
		error: null,
		...overrides,
	};
}

test("mapTransportError keeps possibly-sent mutations unknown", () => {
	const mutationError = mapTransportError(new Error("socket died"), "possibly_sent", "mutation");
	assert.equal(mutationError.code, "outcome_unknown");
	assert.equal(mutationError.retryable, true);

	const readError = mapTransportError(new Error("socket died"), "possibly_sent", "read");
	assert.equal(readError.code, "backend_offline");

	const localError = mapTransportError(new Error("not connected"), "not_sent", "mutation");
	assert.equal(localError.code, "backend_offline");
});

test("mapTransportError labels client aborts and timeouts", () => {
	const timeout = new Error("Backend response timed out after 5ms.");
	const mapped = mapTransportError(timeout, "possibly_sent", "mutation");
	assert.equal(mapped.code, "outcome_unknown");
	assert.equal(mapped.details?.sendState, "possibly_sent");
});

test("V1 backend client validates protocol version and request correlation", async () => {
	const { createBackendClient } = await import("./backend-client.js");
	const mismatched = fakeRequester({
		response: wireResponse({ protocolVersion: 2 as unknown as 1 }),
	});
	const client = createBackendClient({} as never, { requester: mismatched });
	await assert.rejects(client.getInfo(), (error: HopperCoreError) => {
		assert.equal(error.hopperError.code, "protocol_mismatch");
		return true;
	});

	const wrongId = fakeRequester({
		response: wireResponse({ requestId: "req_01MZZZZZZZZZZZZZZZZZZZZZZZ" }),
	});
	const client2 = createBackendClient({} as never, { requester: wrongId });
	await assert.rejects(client2.getInfo(), (error: HopperCoreError) => error.hopperError.code === "protocol_mismatch");
});

test("executeActions rejects a mismatching payload digest before send", async () => {
	const { createBackendClient } = await import("./backend-client.js");
	const { createWireRequest } = await import("./wire.js");
	const requester = fakeRequester({ response: wireResponse() });
	const client = createBackendClient({} as never, { requester });

	const request = {
		...createWireRequest("executeActions", {
			expectedBackendId: "be_x",
			expectedGrasshopperDocumentId: "ghd_y",
			expectedRhinoDocumentId: null,
			expectedCanvasDigest: null,
			transactionName: "t",
			scope: "grasshopper",
			actions: [],
		}),
		payloadSha256: "0".repeat(64),
	} as const;

	await assert.rejects(client.executeActions(request as never), (error: HopperCoreError) => {
		assert.equal(error.hopperError.code, "invalid_input");
		return true;
	});
	assert.equal(requester.captured.length, 0, "must not send a request with a bad digest");
});

test("backend client connects once and reconnects after transport errors", async () => {
	const { createBackendClient } = await import("./backend-client.js");
	let failNext = false;
	const requester = fakeRequester({
		response: (entry) => {
			if (failNext) throw new Error("boom");
			return wireResponse({ requestId: entry.request.requestId, type: entry.request.type });
		},
	});
	const client = createBackendClient({} as never, { requester });

	await client.getInfo();
	await client.getRequestStatus("req_01M0000000000000000000000", "d");
	assert.equal(requester.connected, 1);
	assert.equal(requester.captured.length, 2);
	assert.equal(requester.captured[0]!.request.type, "getBackendInfo");
	assert.equal(requester.captured[1]!.request.body.targetRequestId, "req_01M0000000000000000000000");

	failNext = true;
	await assert.rejects(client.getInfo());
	failNext = false;
	await client.getInfo();
	assert.equal(requester.connected, 2, "must reconnect after a failure");
});
