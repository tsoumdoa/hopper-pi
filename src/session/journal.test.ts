import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { Journal, requestOutcomeEvent, requestStartedEvent } from "./journal.js";
import { journalPath } from "./paths.js";

const SESSION = "hs_01JOURNALTEST0000000000000" as `hs_${string}`;
const REQUEST = "req_01JOURNALTEST0000000000" as `req_${string}`;

async function freshJournal(): Promise<Journal> {
	const root = await mkdtemp(join(tmpdir(), "hopper-journal-"));
	return new Journal(SESSION, journalPath(root, SESSION));
}

function started(editId: `edit_${string}`, operation = "gh_edit_wire") {
	return requestStartedEvent({
		sessionId: SESSION,
		editId,
		requestId: REQUEST,
		occurredAt: "2026-08-15T00:00:00.000Z",
		operation,
		mutationScope: "grasshopper",
		inputSummary: { action: "connectWire" },
		backendId: "be_x",
		grasshopperDocumentId: "ghd_x",
		rhinoDocumentId: null,
		beforeCheckpointId: null,
	});
}

function outcome(editId: `edit_${string}`, state: "succeeded" | "failed" | "partial" | "unknown") {
	return requestOutcomeEvent({
		sessionId: SESSION,
		editId,
		requestId: REQUEST,
		occurredAt: "2026-08-15T00:00:01.000Z",
		outcome: state,
		resultSummary: { source: "test" },
		error: state === "succeeded" ? null : {
			code: "operation_failed",
			message: "nope",
			retryable: false,
		},
		warnings: [],
		afterCheckpointId: null,
		diff: null,
		durationMs: 5,
	});
}

test("replays started and outcome events into materialized edits", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await journal.append(outcome("edit_000001", "succeeded"));
	await journal.append(started("edit_000002"));

	const edits = await journal.materialize();
	assert.equal(edits.length, 2);
	assert.equal(edits[0]!.state, "succeeded");
	assert.equal(edits[0]!.finishedAt, "2026-08-15T00:00:01.000Z");
	assert.equal(edits[1]!.state, "pending");
	assert.equal(journal.path.endsWith("events.jsonl"), true);
});

test("pending -> unknown -> terminal is a legal reconciliation path", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await journal.append(outcome("edit_000001", "unknown"));
	await journal.append(outcome("edit_000001", "succeeded"));
	const edits = await journal.materialize();
	assert.equal(edits[0]!.state, "succeeded");
});

test("a terminal outcome cannot flip to a different one", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await journal.append(outcome("edit_000001", "failed"));
	await journal.append(outcome("edit_000001", "succeeded"));
	await assert.rejects(journal.materialize(), /already ended failed/);
	const verification = await journal.verify();
	assert.equal(verification.ok, false);
	assert.equal(verification.errors[0]?.code, "journal_corrupt");
});

test("duplicate request.started for one edit is corruption", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await journal.append(started("edit_000001"));
	await assert.rejects(journal.materialize(), /started twice/);
});

test("one truncated final line is tolerated with a warning", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await appendFile(journal.path, '{"schemaVersion":1,"eventType":"request.sta', "utf8");
	const { events, truncatedFinalLine } = await journal.readRaw();
	assert.equal(truncatedFinalLine, true);
	assert.equal(events.length, 1);
	const verification = await journal.verify();
	assert.equal(verification.ok, true);
	assert.equal(verification.truncatedFinalLine, true);
});

test("corruption before the final line is a hard journal error", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	await appendFile(journal.path, '{"broken":\n', "utf8");
	await journal.append(started("edit_000002"));
	const verification = await journal.verify();
	assert.equal(verification.ok, false);
	assert.equal(verification.errors[0]?.code, "journal_corrupt");
});

test("find returns the requested edit or null", async () => {
	const journal = await freshJournal();
	await journal.append(started("edit_000001"));
	assert.equal((await journal.find("edit_000001"))?.editId, "edit_000001");
	assert.equal(await journal.find("edit_999999"), null);
});

test("empty journals verify clean", async () => {
	const journal = await freshJournal();
	await writeFile(join(tmpdir(), `probe-${Date.now()}`), "");
	const verification = await journal.verify();
	assert.equal(verification.ok, true);
	assert.equal(verification.errors.length, 0);
});
