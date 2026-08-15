import assert from "node:assert/strict";
import { test } from "vitest";
import { ArgParseError, helpText, isEditId, isSessionId, parseArgs } from "./args.js";

const ENV: NodeJS.ProcessEnv = {};

test("parses status, catalog, schema", () => {
	assert.deepEqual(parseArgs(["status"], ENV), { kind: "status", json: false });
	assert.deepEqual(parseArgs(["catalog", "--json"], ENV), { kind: "catalog", json: true });
	assert.deepEqual(parseArgs(["schema", "gh_apply_graph"], ENV), {
		kind: "schema",
		operation: "gh_apply_graph",
		json: false,
	});
	assert.throws(() => parseArgs(["schema"], ENV), ArgParseError);
	assert.throws(() => parseArgs(["status", "extra"], ENV), ArgParseError);
});

test("call accepts exactly one input source", () => {
	const file = parseArgs(["call", "gh_edit_wire", "--input", "graph.json"], ENV);
	assert.equal(file.kind, "call");
	if (file.kind === "call") {
		assert.deepEqual(file.input, { kind: "file", path: "graph.json" });
		assert.equal(file.allowCapture, false);
	}

	const stdin = parseArgs(["call", "gh_get_canvas", "--input", "-", "--json"], ENV);
	assert.equal(stdin.kind, "call");
	if (stdin.kind === "call") assert.deepEqual(stdin.input, { kind: "stdin" });

	const inline = parseArgs(["call", "gh_get_canvas", "--data", "{}"], ENV);
	assert.equal(inline.kind, "call");
	if (inline.kind === "call") assert.deepEqual(inline.input, { kind: "inline", json: "{}" });

	assert.throws(() => parseArgs(["call", "op"], ENV), ArgParseError);
	assert.throws(
		() => parseArgs(["call", "op", "--input", "a.json", "--data", "{}"], ENV),
		ArgParseError,
	);
	assert.throws(() => parseArgs(["call", "op", "--data"], ENV), ArgParseError);
});

test("call validates session IDs and prefers the flag over the environment", () => {
	const flagged = parseArgs(["call", "op", "--session", "hs_01JX", "--data", "{}"], {
		HOPPER_SESSION_ID: "hs_01JENV",
	});
	assert.equal(flagged.kind, "call");
	assert.equal(flagged.sessionId, "hs_01JX");

	const fromEnv = parseArgs(["call", "op", "--data", "{}"], {
		HOPPER_SESSION_ID: "hs_01JENV",
	});
	assert.equal(fromEnv.kind, "call");
	assert.equal(fromEnv.sessionId, "hs_01JENV");

	assert.throws(
		() => parseArgs(["call", "op", "--session", "nope", "--data", "{}"], ENV),
		ArgParseError,
	);
	assert.throws(
		() => parseArgs(["call", "op", "--data", "{}"], { HOPPER_SESSION_ID: "nope" }),
		ArgParseError,
	);
});

test("allow-capture is an explicit opt-in", () => {
	const parsed = parseArgs(["call", "rh_capture_view", "--input", "-", "--allow-capture"], ENV);
	assert.equal(parsed.kind, "call");
	assert.equal(parsed.allowCapture, true);
});

test("unknown commands and options fail with a message", () => {
	assert.throws(() => parseArgs(["frobnicate"], ENV), /Unknown command/);
	assert.throws(() => parseArgs(["call", "op", "--wat", "--data", "{}"], ENV), ArgParseError);
});

test("id guards accept only branded forms", () => {
	assert.ok(isSessionId("hs_01JX"));
	assert.ok(!isSessionId("req_01JX"));
	assert.ok(isEditId("edit_000004"));
	assert.ok(!isEditId("hs_x"));
});

test("help text documents the command surface", () => {
	const text = helpText();
	assert.match(text, /hopper <command>/);
	assert.match(text, /--json/);
	assert.match(text, /--allow-capture/);
});
