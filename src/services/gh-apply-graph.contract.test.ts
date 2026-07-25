import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

test("applyGraph is a synchronous request and not a queued command action", () => {
	const service = readFileSync(join(root, "grasshopper-plugin/services/ZMqService.cs"), "utf8");
	const registry = readFileSync(join(root, "grasshopper-plugin/CommandActionRegistry.cs"), "utf8");
	assert.match(service, /_requestDispatcher\.Register\("applyGraph"/);
	assert.doesNotMatch(registry, /"applyGraph"/);
});

test("multi-wire graph solves once and selector wiring never solves", () => {
	const graph = readFileSync(join(root, "grasshopper-plugin/operations/GraphOperations.cs"), "utf8");
	const wire = readFileSync(join(root, "grasshopper-plugin/operations/WireOperations.cs"), "utf8");
	assert.equal((graph.match(/doc\.NewSolution\(false\)/g) ?? []).length, 1);

	const selectorBody = wire.split("TryConnectBySelector")[1]?.split("public static")[0] ?? "";
	assert.doesNotMatch(selectorBody, /NewSolution/);
});

test("mid-graph structural failures restore the serialized snapshot", () => {
	const graph = readFileSync(join(root, "grasshopper-plugin/operations/GraphOperations.cs"), "utf8");
	assert.match(graph, /var snapshot = DocumentSnapshots\.Serialize\(doc\)/);
	assert.match(graph, /DocumentSnapshots\.Apply\(doc, snapshot\)/);
	assert.match(graph, /return Rollback\(\$"wires\[/);
	assert.match(graph, /return Rollback\(\$"groups\[/);
});

test("snapshot restore is failure-safe: deserialize before mutating, with a fallback restore", () => {
	const snapshots = readFileSync(join(root, "grasshopper-plugin/operations/DocumentSnapshots.cs"), "utf8");
	// The replacement document is fully built before the live canvas is touched.
	assert.match(snapshots, /var incoming = ExtractDocument\(snapshot\);/);
	// A fallback of the current target is captured so a mid-merge failure can restore it.
	assert.match(snapshots, /var fallback = TrySerialize\(target\);/);
	// The destructive swap is guarded; on failure the fallback is reapplied.
	assert.match(snapshots, /Swap\(target, incoming\)/);
	assert.match(snapshots, /Swap\(target, ExtractDocument\(fallback\)\)/);
	// Deserialize_Binary's return value is checked (no silent proceed on a corrupt snapshot).
	assert.match(snapshots, /if \(!archive\.Deserialize_Binary\(snapshot\)\)/);
});

test("UI-thread timeout is surfaced as an unknown outcome, not a plain error", () => {
	const handlers = readFileSync(join(root, "grasshopper-plugin/services/ZMqRequestHandlers.cs"), "utf8");
	// TimeoutException from RunOnUiThread is caught at the handler level...
	assert.match(handlers, /catch \(TimeoutException\)/);
	// ...and returned as a structured response that flags the unknown outcome, not { error }.
	assert.match(handlers, /TimedOut = true/);
	assert.match(handlers, /Code = "UI_TIMEOUT"/);
});

test("single-undo is recorded only when no turn transaction owns the undo stack", () => {
	const graph = readFileSync(join(root, "grasshopper-plugin/operations/GraphOperations.cs"), "utf8");
	// Guarded by AgentTransaction.IsActive so it never nests under the turn transaction.
	assert.match(graph, /if \(AgentTransaction\.IsActive\)\s+return;/);
	// Records a single snapshot-based undo action on success.
	assert.match(graph, /new DocumentSnapshotUndoAction\(beforeSnapshot, afterSnapshot\)/);
	assert.match(graph, /doc\.UndoUtil\.RecordEvent\("Apply graph"/);
});
