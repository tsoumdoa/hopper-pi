import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { createOperationRegistry } from "../operations/index.js";
import {
	PR1_EXCLUDED_TOOL_NAMES,
	PR1_INPUT_SCHEMA_GOLDEN,
	PR1_PUBLIC_OPERATION_NAMES,
} from "./pr1-operation-input-schema-golden.js";

test("PR 1 freezes the 16 public operation names", () => {
	const names = createOperationRegistry().list().map((entry) => entry.name);
	assert.deepEqual(names, [...PR1_PUBLIC_OPERATION_NAMES]);
	assert.equal(new Set(names).size, PR1_PUBLIC_OPERATION_NAMES.length);
});

test("PR 1 excludes interaction and discovery tools from the operation contract", () => {
	const publicNames = new Set(createOperationRegistry().list().map((entry) => entry.name));
	for (const excludedName of PR1_EXCLUDED_TOOL_NAMES) {
		assert.equal(
			publicNames.has(excludedName),
			false,
			`${excludedName} must remain outside the operation registry`,
		);
	}
});

test("PR 1 preserves every current input schema byte-for-byte", () => {
	const registry = createOperationRegistry();
	for (const name of PR1_PUBLIC_OPERATION_NAMES) {
		const expected = PR1_INPUT_SCHEMA_GOLDEN[name as keyof typeof PR1_INPUT_SCHEMA_GOLDEN];
		assert.ok(expected, `Missing frozen input schema for ${name}`);
		const schema = registry.schema(name);
		assert.ok(schema, `Missing runtime schema for ${name}`);
		const json = JSON.stringify(schema.inputSchema);
		assert.equal(Buffer.byteLength(json, "utf8"), expected.byteLength, `${name} byte length`);
		assert.equal(
			createHash("sha256").update(json, "utf8").digest("hex"),
			expected.sha256,
			`${name} input schema changed`,
		);
	}
});
