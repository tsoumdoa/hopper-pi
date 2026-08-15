import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { Requester } from "./requester.js";

const zmq = vi.hoisted(() => ({ instances: [] as Array<{ closed: boolean }> }));

vi.mock("zeromq", () => ({
	Request: class {
		closed = false;
		constructor() { zmq.instances.push(this); }
		connect() {}
		async send() {}
		async receive(): Promise<[Buffer]> { return new Promise(() => {}); }
		close() { this.closed = true; }
	},
}));

test("Requester rejects a pre-aborted signal before opening ZeroMQ", async () => {
	const controller = new AbortController();
	controller.abort();
	const requester = new Requester(controller.signal);
	await assert.rejects(requester.connect(), (error: unknown) => {
		return error instanceof Error && error.name === "AbortError";
	});
});

test("Requester closes an in-flight request socket when the call is aborted", async () => {
	const controller = new AbortController();
	const requester = new Requester(controller.signal);
	await requester.connect();
	const pending = requester.request({ type: "ping" });
	controller.abort();
	await assert.rejects(pending, (error: unknown) => {
		return error instanceof Error && error.name === "AbortError";
	});
	assert.equal(zmq.instances.at(-1)?.closed, true);
});
