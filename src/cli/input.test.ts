import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "vitest";
import type { CliIO } from "./io.js";
import { loadJsonInput } from "./input.js";
import type { HopperErrorCode } from "../core/errors.js";
import { cliError, mapErrorToExitCode, mapOutcomeToExitCode, type CliResponse } from "./response.js";

function io(stdin: string = "{}"): CliIO {
	return {
		stdin: Readable.from(stdin),
		stdout: new Writable(),
		stderr: new Writable(),
		env: {},
		cwd: tmpdir(),
	};
}

test("loads file, stdin, and inline inputs as JSON objects", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hopper-input-"));
	const path = join(dir, "graph.json");
	await writeFile(path, JSON.stringify({ items: 2 }), "utf8");

	assert.deepEqual(await loadJsonInput({ kind: "file", path }, io()), { items: 2 });
	assert.deepEqual(await loadJsonInput({ kind: "stdin" }, io('{"a":1}')), { a: 1 });
	assert.deepEqual(await loadJsonInput({ kind: "inline", json: '{"b":2}' }, io()), { b: 2 });
});

test("rejects invalid JSON, non-objects, and oversized inputs", async () => {
	await assert.rejects(loadJsonInput({ kind: "inline", json: "nope" }, io()), /not valid JSON/);
	await assert.rejects(loadJsonInput({ kind: "inline", json: "[1,2]" }, io()), /JSON object/);
	await assert.rejects(loadJsonInput({ kind: "inline", json: "null" }, io()), /JSON object/);
	await assert.rejects(
		loadJsonInput({ kind: "stdin" }, io(" ".repeat(64)), 32),
		/exceeds 32 bytes/,
	);
	await assert.rejects(
		loadJsonInput({ kind: "inline", json: JSON.stringify({ value: "éé" }) }, io(), 14),
		/exceeds 14 bytes/,
	);
});

test("exit codes follow the plan mapping", () => {
	assert.equal(mapOutcomeToExitCode(okResponse()), 0);
	assert.equal(
		mapOutcomeToExitCode(failed("outcome_unknown")),
		6,
	);
	assert.equal(mapOutcomeToExitCode(failed("document_conflict")), 4);
	assert.equal(mapOutcomeToExitCode(failed("backend_offline")), 3);
	assert.equal(mapOutcomeToExitCode(failed("invalid_input")), 2);
	assert.equal(mapOutcomeToExitCode(failed("operation_failed")), 5);
	assert.equal(mapOutcomeToExitCode({
		...failed("partial_mutation"),
		outcome: "partial",
	}), 5);
	assert.equal(mapOutcomeToExitCode(failed("journal_corrupt")), 70);
	assert.equal(mapErrorToExitCode({ code: "unsupported_undo", message: "x", retryable: false }), 4);
});

test("cliError responses carry the structured error", () => {
	const response = cliError("call", { code: "invalid_input", message: "bad", retryable: false });
	assert.equal(response.ok, false);
	assert.equal(response.command, "call");
	assert.equal(response.error?.code, "invalid_input");
	assert.equal(response.outcome, "failed");
	assert.deepEqual(response.artifacts, []);
});

function okResponse() {
	return {
		schemaVersion: 1 as const,
		ok: true,
		command: "call",
		outcome: "succeeded" as const,
		message: "done",
		data: null,
		artifacts: [],
		warnings: [],
		error: null,
	};
}

function failed(code: HopperErrorCode): CliResponse {
	return {
		schemaVersion: 1 as const,
		ok: false,
		command: "call",
		outcome: code === "outcome_unknown" ? ("unknown" as const) : ("failed" as const),
		message: "nope",
		data: null,
		artifacts: [],
		warnings: [],
		error: { code, message: "nope", retryable: false },
	};
}
