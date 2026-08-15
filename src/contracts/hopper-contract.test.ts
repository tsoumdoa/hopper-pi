import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
	BACKEND_PROTOCOL_INVENTORY,
	FROZEN_HOPPER_TOOLS,
	LEGACY_TOOL_RESULT_FIXTURES,
	PI_ONLY_TOOLS,
} from "./hopper-contract.fixture.js";
import {
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
} from "../pi/catalog.js";

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("the public Hopper tool contract matches the migration fixture", () => {
	const actual = [...HOPPER_REGISTERED_CATALOG, RH_CAPTURE_VIEW_CATALOG_ENTRY]
		.map(({ tool }) => ({
			name: tool.name,
			title: tool.label,
			parameterSchemaSha256: sha256(tool.parameters),
			descriptionSha256: sha256(tool.description),
			resultContent: tool.name === "rh_capture_view" ? ["text", "image"] : ["text"],
		}))
		.sort((left, right) => left.name.localeCompare(right.name));

	assert.deepEqual(actual, FROZEN_HOPPER_TOOLS);
	assert.equal(new Set(actual.map((tool) => tool.name)).size, 16);
	for (const name of PI_ONLY_TOOLS) {
		assert.ok(!actual.some((tool) => tool.name === name));
	}
});

test("legacy result fixtures cover success and failure for every server tool", () => {
	assert.deepEqual(Object.keys(LEGACY_TOOL_RESULT_FIXTURES).sort(), FROZEN_HOPPER_TOOLS.map(({ name }) => name));
	for (const [name, cases] of Object.entries(LEGACY_TOOL_RESULT_FIXTURES)) {
		assert.ok(cases.success.content.length > 0, `${name} success content`);
		assert.equal(cases.success.content[0]?.type, "text");
		assert.equal(cases.failure.content[0]?.type, "text");
		assert.match(cases.failure.content[0]?.text ?? "", /ERROR/);
	}
});

test("the TypeScript inventory matches both Grasshopper dispatch registries", async () => {
	const commandSource = await readFile("grasshopper-plugin/CommandExecutor.Registry.cs", "utf8");
	const requestSource = await readFile("grasshopper-plugin/services/ZMqService.cs", "utf8");
	const queuedCommands = [...commandSource.matchAll(/\["([^"]+)"\]\s*=/g)]
		.map((match) => match[1])
		.sort();
	const synchronousRequests = [...requestSource.matchAll(/Register\("([^"]+)"/g)]
		.map((match) => match[1])
		.sort();

	assert.deepEqual(queuedCommands, [...BACKEND_PROTOCOL_INVENTORY.queuedCommands].sort());
	assert.deepEqual(synchronousRequests, [...BACKEND_PROTOCOL_INVENTORY.synchronousRequests].sort());
});
