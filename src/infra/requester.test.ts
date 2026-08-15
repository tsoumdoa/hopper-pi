import assert from "node:assert/strict";
import { test } from "vitest";
import { Requester } from "./requester.js";

test("Requester rejects a pre-aborted signal before opening ZeroMQ", async () => {
	const controller = new AbortController();
	controller.abort();
	const requester = new Requester(controller.signal);
	await assert.rejects(requester.connect(), (error: unknown) => {
		return error instanceof Error && error.name === "AbortError";
	});
});
