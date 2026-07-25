import assert from "node:assert/strict";
import { test } from "vitest";
import { createHopperSearchToolsTool } from "./hopper-search-tools.js";
import { applyProgressiveCoreTools } from "../services/progressive-tools.js";
import { HOPPER_SEARCH_TOOLS_NAME, getDiscoverableToolNames } from "./catalog.js";
import { RH_CAPTURE_VIEW_TOOL } from "../services/model-capabilities.js";
import { createRhinoCaptureModelController } from "../services/rhino-capture-model.js";

function fakePi(initialActive: string[], registered: string[] = [...initialActive]) {
	const tools = registered.map((name) => ({ name, description: name, parameters: {} }));
	let activeTools = [...initialActive];
	return {
		registerTool(tool: { name: string }) {
			if (!tools.some((t) => t.name === tool.name)) {
				tools.push({ name: tool.name, description: tool.name, parameters: {} });
			}
		},
		getAllTools() {
			return tools;
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
	};
}

test("applyProgressiveCoreTools deactivates discoverable Hopper tools and keeps built-ins", () => {
	const discoverable = [...getDiscoverableToolNames()];
	const pi = fakePi([
		"read",
		"bash",
		"ask_user",
		"rh_run_script",
		"rh_query_objects",
		"gh_get_canvas",
		...discoverable,
		HOPPER_SEARCH_TOOLS_NAME,
	]);

	const next = applyProgressiveCoreTools(pi as any);
	assert.ok(next.includes("read"));
	assert.ok(next.includes("bash"));
	assert.ok(next.includes("ask_user"));
	assert.ok(next.includes("rh_run_script"));
	assert.ok(next.includes("gh_get_canvas"));
	assert.ok(next.includes(HOPPER_SEARCH_TOOLS_NAME));
	for (const name of discoverable) {
		assert.equal(next.includes(name), false, `${name} should be inactive`);
	}
});

test("hopper_search_tools activates matches additively and never removes tools", async () => {
	const pi = fakePi(
		["read", "rh_run_script", "gh_get_canvas", HOPPER_SEARCH_TOOLS_NAME],
		[
			"read",
			"rh_run_script",
			"gh_get_canvas",
			HOPPER_SEARCH_TOOLS_NAME,
			"gh_edit_wire",
			"gh_edit_script",
			"rh_view_control",
		],
	);
	const tool = createHopperSearchToolsTool(pi as any, { maxActivate: 5 });
	const result = await tool.execute(
		"1",
		{ query: "connect wires" },
		undefined,
		undefined,
		{} as any,
	);

	const active = pi.getActiveTools();
	assert.ok(active.includes("read"));
	assert.ok(active.includes("rh_run_script"));
	assert.ok(active.includes("gh_edit_wire"));
	assert.ok(active.includes(HOPPER_SEARCH_TOOLS_NAME));
	const activateText = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
	assert.match(activateText, /Activated: gh_edit_wire|already-active|Matched/);
	const details = result.details as { activated: string[] };
	assert.ok(details.activated.includes("gh_edit_wire"));
});

test("hopper_search_tools reports no-match hints and respects limit", async () => {
	const pi = fakePi(
		["rh_run_script", HOPPER_SEARCH_TOOLS_NAME],
		["rh_run_script", HOPPER_SEARCH_TOOLS_NAME, "gh_edit_script", "gh_edit_param", "gh_create_widget"],
	);
	const tool = createHopperSearchToolsTool(pi as any, { maxActivate: 1 });

	const miss = await tool.execute("1", { query: "zzzz quantum foam" }, undefined, undefined, {} as any);
	const missText = miss.content[0] && "text" in miss.content[0] ? miss.content[0].text : "";
	assert.match(missText, /No Hopper tools matched/);
	const missDetails = miss.details as { hint?: string };
	assert.ok(missDetails.hint);

	const limited = await tool.execute(
		"2",
		{ query: "grasshopper script edit ports widget", limit: 1 },
		undefined,
		undefined,
		{} as any,
	);
	const limitedDetails = limited.details as { activated: string[]; truncated: boolean; limit: number };
	assert.equal(limitedDetails.limit, 1);
	assert.ok(limitedDetails.activated.length <= 1);
});

test("progressive core composes with rh_capture_view model gating", () => {
	const discoverable = [...getDiscoverableToolNames()];
	const pi = fakePi([
		"read",
		"rh_run_script",
		"gh_get_canvas",
		...discoverable,
		HOPPER_SEARCH_TOOLS_NAME,
	]);
	const capture = createRhinoCaptureModelController(pi as any);

	applyProgressiveCoreTools(pi as any);
	capture.syncCaptureToolForModel({ provider: "test", id: "vision", input: ["text", "image"] });
	assert.ok(pi.getActiveTools().includes(RH_CAPTURE_VIEW_TOOL));
	assert.ok(pi.getActiveTools().includes("rh_run_script"));
	assert.equal(pi.getActiveTools().includes("gh_edit_script"), false);

	capture.syncCaptureToolForModel({ provider: "test", id: "text", input: ["text"] });
	assert.equal(pi.getActiveTools().includes(RH_CAPTURE_VIEW_TOOL), false);
	assert.ok(pi.getActiveTools().includes("rh_run_script"));

	// Loader can still add specialists while capture stays gated off.
	const before = pi.getActiveTools();
	pi.setActiveTools([...before, "gh_edit_wire"]);
	assert.ok(pi.getActiveTools().includes("gh_edit_wire"));
	assert.equal(pi.getActiveTools().includes(RH_CAPTURE_VIEW_TOOL), false);
});

test("hopper_search_tools does not activate already-active matches twice", async () => {
	const discoverable = [...getDiscoverableToolNames()];
	const pi = fakePi(
		["rh_run_script", "gh_edit_wire", HOPPER_SEARCH_TOOLS_NAME],
		["rh_run_script", "gh_edit_wire", HOPPER_SEARCH_TOOLS_NAME, ...discoverable],
	);
	const before = pi.getActiveTools();
	const tool = createHopperSearchToolsTool(pi as any, { maxActivate: 3 });
	const result = await tool.execute("1", { query: "gh_edit_wire" }, undefined, undefined, {} as any);
	const details = result.details as { activated: string[]; alreadyActive: string[] };
	assert.ok(details.alreadyActive.includes("gh_edit_wire"));
	assert.equal(details.activated.includes("gh_edit_wire"), false);
	assert.ok(pi.getActiveTools().includes("rh_run_script"));
	assert.ok(pi.getActiveTools().includes("gh_edit_wire"));
	// Additive only: every previously active tool remains.
	for (const name of before) {
		assert.ok(pi.getActiveTools().includes(name));
	}
});
