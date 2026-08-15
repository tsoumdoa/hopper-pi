import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { HopperStdioTransport, parseStdioArgs } from "./stdio.js";

test("stdio serves both eras unless modern-only is requested", () => {
	assert.deepEqual(parseStdioArgs([]), { modernOnly: false });
	assert.deepEqual(parseStdioArgs(["--modern-only"]), { modernOnly: true });
	assert.throws(() => parseStdioArgs(["--legacy-only"]), /Unknown argument/);
});

test("stdio EOF closes the transport-owned subscriber lifecycle once", async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	let shutdowns = 0;
	const transport = new HopperStdioTransport(input, output, async () => { shutdowns += 1; });
	await transport.start();
	input.end();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(shutdowns, 1);
	await transport.close();
	assert.equal(shutdowns, 1);
});

test("explicit stdio transport close shuts down its subscriber lifecycle", async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	let shutdowns = 0;
	const transport = new HopperStdioTransport(input, output, async () => { shutdowns += 1; });
	await transport.start();
	await transport.close();
	assert.equal(shutdowns, 1);
});
