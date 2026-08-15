import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import {
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
} from "../tools/catalog.js";
import {
	PR1_EXCLUDED_TOOL_NAMES,
	PR1_INPUT_SCHEMA_GOLDEN,
	PR1_PUBLIC_OPERATION_NAMES,
} from "./pr1-operation-input-schema-golden.js";

const currentPublicTools = [
	...HOPPER_REGISTERED_CATALOG.map((entry) => entry.tool),
	RH_CAPTURE_VIEW_CATALOG_ENTRY.tool,
];

test("PR 1 freezes the 16 public operation names", () => {
	const actualNames = currentPublicTools.map((tool) => tool.name).sort();
	assert.deepEqual(actualNames, [...PR1_PUBLIC_OPERATION_NAMES]);
	assert.equal(new Set(actualNames).size, PR1_PUBLIC_OPERATION_NAMES.length);
});

test("PR 1 excludes interaction and discovery tools from the operation contract", () => {
	const publicNames = new Set(currentPublicTools.map((tool) => tool.name));
	for (const excludedName of PR1_EXCLUDED_TOOL_NAMES) {
		assert.equal(
			publicNames.has(excludedName),
			false,
			`${excludedName} must remain outside the operation registry`,
		);
	}
});

test("PR 1 preserves every current input schema byte-for-byte", () => {
	for (const tool of currentPublicTools) {
		const expected = PR1_INPUT_SCHEMA_GOLDEN[
			tool.name as keyof typeof PR1_INPUT_SCHEMA_GOLDEN
		];
		assert.ok(expected, `Missing frozen input schema for ${tool.name}`);

		const json = JSON.stringify(tool.parameters);
		assert.equal(Buffer.byteLength(json, "utf8"), expected.byteLength, `${tool.name} byte length`);
		assert.equal(
			createHash("sha256").update(json, "utf8").digest("hex"),
			expected.sha256,
			`${tool.name} input schema changed`,
		);
	}
});
