import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { createSyntheticSourceInfo, type ToolInfo } from "@earendil-works/pi-coding-agent";
import {
	formatAllToolSchemasJson,
	formatToolSchemaJson,
	listToolSelectOptions,
	resolveToolSchemaSelection,
	toAgentToolSchema,
	VIEW_ALL_LABEL,
} from "./tool-schemas.js";

function fakeTool(partial: Partial<ToolInfo> & Pick<ToolInfo, "name">): ToolInfo {
	return {
		description: partial.description ?? `${partial.name} description`,
		parameters: partial.parameters ?? Type.Object({}),
		promptGuidelines: partial.promptGuidelines,
		sourceInfo: partial.sourceInfo ?? createSyntheticSourceInfo("test", { source: "test" }),
		...partial,
	};
}

test("toAgentToolSchema keeps only agent-facing fields", () => {
	const tool = fakeTool({
		name: "rh_run_script",
		description: "Run scripts",
		parameters: Type.Object({
			items: Type.Array(Type.String(), { minItems: 1 }),
		}),
		promptGuidelines: ["Prefer Python for multi-step work"],
	});

	assert.deepEqual(toAgentToolSchema(tool), {
		name: "rh_run_script",
		description: "Run scripts",
		parameters: tool.parameters,
		promptGuidelines: ["Prefer Python for multi-step work"],
	});
});

test("toAgentToolSchema omits empty promptGuidelines", () => {
	const tool = fakeTool({
		name: "gh_get_canvas_errors",
		promptGuidelines: [],
	});

	assert.equal("promptGuidelines" in toAgentToolSchema(tool), false);
});

test("formatToolSchemaJson emits JSON Schema parameters", () => {
	const tool = fakeTool({
		name: "demo",
		parameters: Type.Object({
			mode: Type.Literal("command"),
			count: Type.Optional(Type.Number()),
		}),
	});

	const parsed = JSON.parse(formatToolSchemaJson(tool));
	assert.equal(parsed.name, "demo");
	assert.equal(parsed.parameters.type, "object");
	assert.deepEqual(parsed.parameters.required, ["mode"]);
	assert.equal(parsed.parameters.properties.mode.const, "command");
	assert.equal(parsed.parameters.properties.count.type, "number");
});

test("formatAllToolSchemasJson and select options cover every tool", () => {
	const tools = [
		fakeTool({ name: "zh_tool" }),
		fakeTool({ name: "ah_tool" }),
		fakeTool({ name: "mh_tool" }),
	];

	assert.deepEqual(listToolSelectOptions(tools), [
		VIEW_ALL_LABEL,
		"ah_tool",
		"mh_tool",
		"zh_tool",
	]);

	const all = JSON.parse(formatAllToolSchemasJson(tools));
	assert.deepEqual(all.map((tool: { name: string }) => tool.name), [
		"zh_tool",
		"ah_tool",
		"mh_tool",
	]);
});

test("resolveToolSchemaSelection supports tool name, all, and view-all label", () => {
	const tools = [
		fakeTool({
			name: "rh_view_control",
			description: "Viewport control",
			parameters: Type.Object({ action: Type.String() }),
		}),
	];

	const byName = resolveToolSchemaSelection(tools, "rh_view_control");
	assert.ok(byName);
	assert.equal(byName.title, "Schema: rh_view_control");
	assert.match(byName.json, /"name": "rh_view_control"/);

	const byAll = resolveToolSchemaSelection(tools, "all");
	assert.ok(byAll);
	assert.equal(byAll.title, "Agent tool schemas (1)");
	assert.equal(JSON.parse(byAll.json).length, 1);

	const byLabel = resolveToolSchemaSelection(tools, VIEW_ALL_LABEL);
	assert.ok(byLabel);
	assert.equal(byLabel.json, byAll.json);

	assert.equal(resolveToolSchemaSelection(tools, "missing_tool"), undefined);
});
