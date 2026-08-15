import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { test } from "vitest";
import { FROZEN_HOPPER_TOOLS, PI_ONLY_TOOLS } from "../contracts/hopper-contract.fixture.js";
import { HOPPER_TOOLS } from "../core/tool-registry.js";
import { createHopperMcpServer, HOPPER_MCP_TOOL_DEFINITIONS } from "./create-server.js";

test("MCP definitions preserve the stable 16-tool core catalog", () => {
	assert.deepEqual(
		HOPPER_MCP_TOOL_DEFINITIONS.map((tool) => tool.name),
		HOPPER_TOOLS.map((tool) => tool.name),
	);
	assert.equal(HOPPER_MCP_TOOL_DEFINITIONS.length, 16);
	assert.equal(new Set(HOPPER_MCP_TOOL_DEFINITIONS.map((tool) => tool.name)).size, 16);

	const frozenByName = new Map(FROZEN_HOPPER_TOOLS.map((tool) => [tool.name, tool]));
	for (const definition of HOPPER_MCP_TOOL_DEFINITIONS) {
		assert.equal(definition.title, frozenByName.get(definition.name)?.title);
		assert.equal(definition.inputSchema.type, "object");
		assert.equal(definition.outputSchema.type, "object");
		for (const annotation of Object.values(definition.annotations)) {
			assert.equal(typeof annotation, "boolean");
		}
	}

	for (const name of PI_ONLY_TOOLS) {
		assert.ok(!HOPPER_MCP_TOOL_DEFINITIONS.some((tool) => tool.name === name));
	}
});

test("official SDK tools/list exposes the same deterministic definitions", async () => {
	const server = createHopperMcpServer({ version: "test" });
	const client = new Client({ name: "hopper-test", version: "test" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const result = await client.listTools();

		assert.deepEqual(
			result.tools.map((tool) => tool.name),
			HOPPER_MCP_TOOL_DEFINITIONS.map((tool) => tool.name),
		);
		for (const [index, tool] of result.tools.entries()) {
			const expected = HOPPER_MCP_TOOL_DEFINITIONS[index];
			assert.equal(tool.title, expected.title);
			assert.equal(tool.description, expected.description);
			assert.deepEqual(tool.inputSchema, expected.inputSchema);
			assert.deepEqual(tool.outputSchema, expected.outputSchema);
			assert.deepEqual(tool.annotations, expected.annotations);
		}
	} finally {
		await client.close();
		await server.close();
	}
});
