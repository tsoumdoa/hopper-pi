import assert from "node:assert/strict";
import { test } from "vitest";
import { formatApplyGraphFailure, ghApplyGraphTool } from "./gh-apply-graph.js";

function collectDraft07TupleIssues(schema: unknown, path = "$"): string[] {
	if (!schema || typeof schema !== "object") return [];
	if (Array.isArray(schema)) {
		return schema.flatMap((value, index) => collectDraft07TupleIssues(value, `${path}[${index}]`));
	}

	const record = schema as Record<string, unknown>;
	const issues: string[] = [];
	if (Array.isArray(record.items)) {
		issues.push(`${path}.items uses draft-07 tuple array form`);
	}
	if ("additionalItems" in record) {
		issues.push(`${path}.additionalItems is invalid in draft 2020-12`);
	}
	for (const [key, value] of Object.entries(record)) {
		if (key === "items" && Array.isArray(value)) continue;
		issues.push(...collectDraft07TupleIssues(value, `${path}.${key}`));
	}
	return issues;
}

test("gh_apply_graph wire endpoints use draft 2020-12 prefixItems tuples", () => {
	const schema = ghApplyGraphTool.parameters as Record<string, unknown>;
	const issues = collectDraft07TupleIssues(schema);
	assert.deepEqual(issues, []);

	const wires = (schema.properties as Record<string, any>).wires.items.properties;
	for (const end of ["from", "to"] as const) {
		assert.equal(wires[end].type, "array");
		assert.ok(Array.isArray(wires[end].prefixItems));
		assert.equal(wires[end].prefixItems.length, 2);
		assert.equal(wires[end].items, false);
		assert.equal(wires[end].minItems, 2);
		assert.equal(wires[end].maxItems, 2);
	}
});

test("gh_apply_graph keeps rollback-unconfirmed failures unknown in Pi output", () => {
	const text = formatApplyGraphFailure({
		outcome: "unknown",
		message: "Graph apply failed and rollback was not confirmed. Inspect with gh call get-canvas before deciding whether to retry.",
		target: null,
		data: {
			rolledBack: false,
			timedOut: false,
			counts: { components: 1, widgets: 0, scripts: 0, wires: 0, groups: 0 },
			refs: { node: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
			structuralErrors: [],
			runtimeMessages: [],
			overlaps: null,
			elapsedMs: 1,
		},
		error: {
			code: "MUTATION_OUTCOME_UNKNOWN",
			message: "Graph apply failed and rollback was not confirmed.",
			retryable: false,
		},
	});

	assert.match(text, /^UNKNOWN:/);
	assert.match(text, /inspect/i);
	assert.doesNotMatch(text, /^Graph not applied/);
});
