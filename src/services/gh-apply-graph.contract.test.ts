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
