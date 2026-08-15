import assert from "node:assert/strict";
import { test } from "vitest";
import { HopperCoreError } from "../core/errors.js";
import { Requester, type RequestSocket } from "./requester.js";
import { createWireRequest } from "../protocol/wire.js";
import type { WireResponse } from "../protocol/wire.js";

type ScriptedSocket = RequestSocket & {
	sent: string[];
	respondWith: (payload: string) => void;
	hang: boolean;
	closes: number;
	lingerAtClose: number[];
	awaitResponse: () => string;
};

function scriptedSocket(): ScriptedSocket {
	const socket: ScriptedSocket = {
		linger: -1,
		sent: [],
		closes: 0,
		lingerAtClose: [],
		hang: false,
		respondWith: () => {},
		async connect() {},
		async send(payload: string) {
			socket.sent.push(payload);
		},
		async receive() {
			if (socket.hang) {
				await new Promise(() => {});
			}
			return [Buffer.from(socket.awaitResponse())] as unknown as readonly Uint8Array[];
		},
		awaitResponse: () => "",
		close() {
			socket.closes += 1;
			socket.lingerAtClose.push(socket.linger);
		},
	} as never;
	// Simplify: queue-based response holder.
	const pending: string[] = [];
	socket.respondWith = (payload: string) => pending.push(payload);
	(socket as unknown as { awaitResponse: () => string }).awaitResponse = () =>
		pending.shift() ?? "{}";
	return socket;
}

function okResponse(requestId: `req_${string}`): string {
	const response: WireResponse = {
		protocolVersion: 1,
		type: "getBackendInfo",
		requestId,
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
	};
	return JSON.stringify(response);
}

test("request sends the token-attached payload and parses the wire response", async () => {
	const socket = scriptedSocket();
	const requester = new Requester({
		connection: {
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			token: "sekrit",
			source: "defaults",
			profilePath: "/tmp/profile.json",
		},
		socketFactory: async () => socket,
	});
	await requester.connect();
	const request = createWireRequest("getBackendInfo", {}, {
		requestId: "req_01M0000000000000000000000",
	});
	socket.respondWith(okResponse(request.requestId));

	const response = await requester.request(request, { receiveTimeoutMs: 1_000 });

	assert.equal(response.outcome, "succeeded");
	assert.equal(socket.sent.length, 1);
	const sent = JSON.parse(socket.sent[0]!) as { token?: string; type: string };
	assert.equal(sent.token, "sekrit");
	assert.equal(sent.type, "getBackendInfo");
});

test("timeout closes the socket with zero linger and never reuses it", async () => {
	const socket = scriptedSocket();
	socket.hang = true;
	const requester = new Requester({
		connection: {
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/profile.json",
		},
		socketFactory: async () => socket,
	});
	await requester.connect();
	const request = createWireRequest("executeActions", {
		expectedBackendId: "be_x",
		expectedGrasshopperDocumentId: "ghd_y",
		expectedRhinoDocumentId: null,
		expectedCanvasDigest: null,
		transactionName: "t",
		scope: "grasshopper",
		actions: [],
	});

	await assert.rejects(
		requester.request(request, { receiveTimeoutMs: 20 }),
		(error: unknown) => {
			const hopper = error as HopperCoreError;
			assert.equal(hopper.name, "HopperCoreError");
			assert.equal(hopper.hopperError.code, "outcome_unknown");
			return true;
		},
	);

	assert.equal(socket.closes, 1);
	assert.equal(socket.lingerAtClose[0], 0, "closed sockets must not linger");

	// A retry must not reuse the invalidated socket.
	await assert.rejects(
		requester.request(request, { receiveTimeoutMs: 20 }),
		(error: unknown) => {
			assert.equal((error as HopperCoreError).hopperError.code, "backend_offline");
			return true;
		},
	);
	assert.equal(socket.closes, 1, "the old socket must not be closed twice");
	assert.equal(socket.sent.length, 1);
});

test("aborting a mutation after send reports an unknown outcome", async () => {
	const socket = scriptedSocket();
	socket.hang = true;
	const requester = new Requester({
		connection: {
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/profile.json",
		},
		socketFactory: async () => socket,
	});
	await requester.connect();
	const controller = new AbortController();
	const request = createWireRequest("executeActions", {
		expectedBackendId: "be_x",
		expectedGrasshopperDocumentId: "ghd_y",
		expectedRhinoDocumentId: null,
		expectedCanvasDigest: null,
		transactionName: "t",
		scope: "grasshopper",
		actions: [],
	});
	setTimeout(() => controller.abort(), 5);
	await assert.rejects(
		requester.request(request, { receiveTimeoutMs: 5_000, signal: controller.signal }),
		(error: unknown) => {
			assert.equal((error as HopperCoreError).hopperError.code, "outcome_unknown");
			return true;
		},
	);
	assert.equal(socket.closes, 1);
});

test("oversized and malformed responses are protocol errors", async () => {
	const socket = scriptedSocket();
	const requester = new Requester({
		maxResponseBytes: 64,
		connection: {
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/profile.json",
		},
		socketFactory: async () => socket,
	});
	await requester.connect();
	socket.respondWith(`${"x".repeat(200)}`);
	await assert.rejects(
		requester.request(createWireRequest("getBackendInfo", {}), { receiveTimeoutMs: 1_000 }),
		(error: unknown) => (error as HopperCoreError).hopperError.code === "protocol_mismatch",
	);

	// Reconnect for the malformed case.
	await requester.connect();
	socket.respondWith("not-json");
	await assert.rejects(
		requester.request(createWireRequest("getBackendInfo", {}), { receiveTimeoutMs: 1_000 }),
		(error: unknown) => (error as HopperCoreError).hopperError.code === "protocol_mismatch",
	);
});

test("read timeouts map to backend_offline, not outcome_unknown", async () => {
	const socket = scriptedSocket();
	socket.hang = true;
	const requester = new Requester({
		connection: {
			pubEndpoint: "tcp://127.0.0.1:1",
			pushEndpoint: "tcp://127.0.0.1:2",
			reqEndpoint: "tcp://127.0.0.1:3",
			source: "defaults",
			profilePath: "/tmp/profile.json",
		},
		socketFactory: async () => socket,
	});
	await requester.connect();
	await assert.rejects(
		requester.request(createWireRequest("getBackendInfo", {}), { receiveTimeoutMs: 20 }),
		(error: unknown) => {
			assert.equal((error as HopperCoreError).hopperError.code, "backend_offline");
			return true;
		},
	);
});
