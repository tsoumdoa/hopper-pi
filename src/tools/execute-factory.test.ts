import assert from "node:assert/strict";
import { test } from "vitest";
import { formatMutationSummary } from "./execute-factory.js";

test("successful mutation batches report counts without per-item job IDs", () => {
	const text = formatMutationSummary(12, []);
	assert.equal(text, "Submitted 12 mutations.");
	assert.doesNotMatch(text, /job/i);
});

test("mutation summaries aggregate failures", () => {
	const text = formatMutationSummary(2, ["moveComponent: offline"]);
	assert.match(text, /^Submitted 2 mutations\./);
	assert.match(text, /1 failure:/);
	assert.match(text, /offline/);
	assert.doesNotMatch(text, /jobId/i);
});
