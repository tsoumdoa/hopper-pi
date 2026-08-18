import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, test } from "vitest";
import { runCli } from "./main.js";
import { RequestTransportError } from "../infra/requester.js";
import type { BackendRequest } from "../core/operations.js";
import { clearConnectionCache } from "../infra/connection.js";

const target = {
	backendInstanceId: "backend-1",
	ghDocument: { path: "/tmp/trial.gh", runtimeId: "gh-runtime-1" },
	rhinoDocument: { name: "trial.3dm", runtimeSerialNumber: 42 },
};

function capture() {
	let value = "";
	return {
		stream: { write(chunk: string | Uint8Array) { value += chunk.toString(); return true; } },
		read() { return value; },
	};
}

async function invoke(args: string[], request?: BackendRequest, stdin?: NodeJS.ReadableStream) {
	const stdout = capture();
	const stderr = capture();
	const exitCode = await runCli(["node", "hopper", ...args], { request, stdin, stdout: stdout.stream, stderr: stderr.stream });
	const lines = stdout.read().trim().split("\n");
	return { exitCode, lines, json: JSON.parse(lines[0]), stderr: stderr.read() };
}

describe("hopper JSON CLI", () => {
	test("offline operations and schemas return one deterministic JSON object", async () => {
		const operations = await invoke(["gh", "operations", "--json"]);
		assert.equal(operations.exitCode, 0);
		assert.equal(operations.lines.length, 1);
		assert.deepEqual(operations.json.data.map((item: { name: string }) => item.name), ["get-canvas", "list-components", "apply-graph"]);

		const schema = await invoke(["gh", "schema", "list-components", "--json"]);
		assert.equal(schema.exitCode, 0);
		assert.equal(schema.json.data.$schema, "https://json-schema.org/draft/2020-12/schema");
		assert.equal(schema.json.data.input.additionalProperties, false);
		assert(schema.json.data.input.properties.searchFrom.anyOf.some((item: { const?: string }) => item.const === "all"));
	});

	test("rejects malformed, conflicting, and repeated input before backend access", async () => {
		let requests = 0;
		const request = async () => { requests++; return {}; };
		for (const args of [
			["gh", "call", "get-canvas", "--json"],
			["gh", "call", "get-canvas", "--data", "[]", "--json"],
			["gh", "call", "get-canvas", "--data", "{}", "--input", "-", "--json"],
			["gh", "call", "get-canvas", "--data", "{}", "--data", "{}", "--json"],
			["gh", "call", "get-canvas", "--data", "{\"extra\":true}", "--json"],
		]) {
			const result = await invoke(args, request, Readable.from(["{}"]));
			assert.equal(result.exitCode, 2);
			assert.equal(result.lines.length, 1);
			assert.equal(result.json.ok, false);
		}
		assert.equal(requests, 0);
	});

	test("invalid graph structure does not fetch the component registry", async () => {
		let requests = 0;
		const result = await invoke(
			["gh", "call", "apply-graph", "--data", "{\"components\":[]}", "--json"],
			async () => { requests++; return {}; },
		);
		assert.equal(result.exitCode, 2);
		assert.equal(result.json.error.code, "INPUT_SCHEMA_INVALID");
		assert.equal(requests, 0);
	});

	test("component search emits full canonical GUIDs", async () => {
		const fullGuid = "11111111-2222-3333-4444-555555555555";
		const result = await invoke(
			["gh", "call", "list-components", "--data", "{\"queries\":[\"curve length\"],\"searchFrom\":\"all\"}", "--json"],
			async () => ({
				type: "listAllComponents.response",
				timestamp: 1,
				target,
				components: [{ name: "Curve Length", typeGuid: fullGuid, pluginName: "Grasshopper", assemblyName: "Grasshopper", category: "Curve", subcategory: "Analysis", description: "Measure curve length" }],
			}),
		);
		assert.equal(result.exitCode, 0);
		assert.equal(result.json.data.results[0].candidates[0].typeGuid, fullGuid);
		assert.deepEqual(result.json.target, target);
	});

	test("strips ANSI escapes from every JSON string field", async () => {
		const result = await invoke(
			["gh", "call", "list-components", "--data", "{\"queries\":[\"curve\"],\"searchFrom\":\"all\"}", "--json"],
			async () => ({
				type: "listAllComponents.response", timestamp: 1, target,
				components: [{ name: "\u001b[31mCurve\u001b[0m", typeGuid: "11111111-2222-3333-4444-555555555555", pluginName: "Grasshopper", assemblyName: "Grasshopper", category: "Curve", subcategory: "Analysis", description: "curve" }],
			}),
		);
		assert.equal(result.exitCode, 0);
		assert(!result.lines[0].includes("\u001b"));
	});

	test("authentication failures map to exit 3 without exposing backend text", async () => {
		const result = await invoke(
			["rh", "call", "query-objects", "--data", "{}", "--json"],
			async () => ({ type: "auth.error", timestamp: 1, error: "backend-private-detail" }),
		);
		assert.equal(result.exitCode, 3);
		assert.equal(result.json.error.code, "AUTHENTICATION_FAILED");
		assert(!JSON.stringify(result.json).includes("backend-private-detail"));
	});

	test("a transport failure after mutation send is unknown and never retryable", async () => {
		const result = await invoke(
			["gh", "call", "apply-graph", "--data", "{\"widgets\":[{\"ref\":\"x\",\"x\":20,\"y\":20,\"kind\":\"toggle\",\"value\":true}]}", "--json"],
			async () => { throw new RequestTransportError("dropped", "receive", true, "transport"); },
		);
		assert.equal(result.exitCode, 5);
		assert.equal(result.json.outcome, "unknown");
		assert.equal(result.json.error.retryable, false);
		assert.match(result.json.message, /get-canvas/);
	});

	test("an unconfirmed apply rollback is unknown", async () => {
		const result = await invoke(
			["gh", "call", "apply-graph", "--data", "{\"widgets\":[{\"ref\":\"x\",\"x\":20,\"y\":20,\"kind\":\"toggle\",\"value\":true}]}", "--json"],
			async () => ({
				type: "applyGraph.response", timestamp: 1, target, ok: false, rolledBack: false, timedOut: false,
				counts: { components: 0, widgets: 0, scripts: 0, wires: 0, groups: 0 }, refs: {},
				structuralErrors: [{ path: "$", code: "WIRE_FAILED", message: "rollback restore failed" }], elapsedMs: 1,
			}),
		);
		assert.equal(result.exitCode, 5);
		assert.equal(result.json.outcome, "unknown");
		assert.match(result.json.message, /rollback was not confirmed/);
	});

	test("status reports backend start time and target identity", async () => {
		const result = await invoke(["status", "--json"], async () => ({
			type: "ping.response",
			timestamp: 20,
			backendStartedAt: 10,
			target,
		}));
		assert.equal(result.exitCode, 0);
		assert.equal(result.json.data.backendStartedAt, 10);
		assert.deepEqual(result.json.target, target);
	});

	test("a later script item failure is unknown after an earlier item ran", async () => {
		let call = 0;
		const result = await invoke(
			["rh", "call", "run-script", "--data", "{\"items\":[{\"mode\":\"command\",\"source\":\"_SelNone\"},{\"mode\":\"command\",\"source\":\"_SelAll\"}]}", "--json"],
			async () => {
				call++;
				return call === 1
					? { type: "runRhinoScript.response", timestamp: 1, target, ok: true, output: "", error: "" }
					: { type: "auth.error", timestamp: 2, error: "rejected" };
			},
		);
		assert.equal(result.exitCode, 5);
		assert.equal(result.json.outcome, "unknown");
		assert.equal(result.json.data.items.length, 1);
	});

	test("an invalid request endpoint maps to backend unavailable", async () => {
		const previous = process.env.GH_ZMQ_REQ;
		process.env.GH_ZMQ_REQ = "definitely-invalid";
		clearConnectionCache();
		try {
			const result = await invoke(["gh", "call", "get-canvas", "--data", "{}", "--json"]);
			assert.equal(result.exitCode, 3);
			assert.equal(result.json.error.code, "BACKEND_UNAVAILABLE");
		} finally {
			if (previous === undefined) delete process.env.GH_ZMQ_REQ;
			else process.env.GH_ZMQ_REQ = previous;
			clearConnectionCache();
		}
	});
});
