import assert from "node:assert/strict";
import { test } from "vitest";
import { FROZEN_HOPPER_TOOLS, PI_ONLY_TOOLS } from "../contracts/hopper-contract.fixture.js";
import { HOPPER_TOOLS } from "./tool-registry.js";

test("core registry exposes the frozen server tools in stable order", () => {
	const names = HOPPER_TOOLS.map((tool) => tool.name);
	assert.equal(names.length, 16);
	assert.equal(new Set(names).size, names.length);
	assert.deepEqual(
		[...names].sort(),
		FROZEN_HOPPER_TOOLS.map((tool) => tool.name),
	);
	for (const name of PI_ONLY_TOOLS) assert.ok(!names.includes(name as never));
});

test("every core tool carries portable schemas and annotations", () => {
	for (const tool of HOPPER_TOOLS) {
		assert.ok(tool.title, `${tool.name} title`);
		assert.equal(tool.inputSchema, tool.parameters);
		assert.equal(typeof tool.outputSchema, "object");
		assert.equal(typeof tool.execute, "function");
		for (const value of Object.values(tool.annotations)) {
			assert.equal(typeof value, "boolean", `${tool.name} annotation`);
		}
	}
});
