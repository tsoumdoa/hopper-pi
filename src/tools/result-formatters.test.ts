import assert from "node:assert/strict";
import { test } from "vitest";
import { formatDefaultResult, shortenGuidsInText } from "./result-formatters.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";

test("shortenGuidsInText replaces full GUIDs with resolvable short ids", () => {
	const guid = "12345678-abcd-4321-9876-1234567890ab";
	const text = `addComponent: added Plane Surface 'Base' componentId=${guid}`;
	const shortened = shortenGuidsInText(text);

	assert.ok(!shortened.includes(guid), "full GUID should be replaced");
	const shortId = shortened.match(/componentId=(\S+)/)?.[1];
	assert.ok(shortId, "short id present");
	assert.equal(resolveInstanceGuid(shortId!).toLowerCase(), guid.toLowerCase());
});

test("shortenGuidsInText shortens every GUID in a ports listing", () => {
	const g1 = "11111111-1111-4111-8111-111111111111";
	const g2 = "22222222-2222-4222-8222-222222222222";
	const text = `inputs[P=${g1}] outputs[S=${g2}]`;
	const shortened = shortenGuidsInText(text);
	assert.ok(!shortened.includes(g1));
	assert.ok(!shortened.includes(g2));
});

test("formatDefaultResult reports job failure with error text", () => {
	const message = formatDefaultResult(
		{ action: "connect", targetId: "abcd" },
		{ jobId: "job-1", state: "failed", error: "connectWire error: port not found" },
	);
	assert.ok(message.includes("FAILED"));
	assert.ok(message.includes("port not found"));
});

test("formatDefaultResult prefers plugin result string when available", () => {
	const message = formatDefaultResult(
		{ action: "move", targetId: "abcd" },
		{ jobId: "job-2", state: "completed", result: "moveComponent: moved to (10, 20)" },
	);
	assert.ok(message.includes("moveComponent: moved to (10, 20)"));
	assert.ok(!message.includes("jobId"));
});

test("formatDefaultResult falls back to jobId when no status arrived", () => {
	const message = formatDefaultResult(
		{ action: "move", targetId: "abcd" },
		{ jobId: "job-3" },
	);
	assert.ok(message.includes("jobId=job-3"));
});
