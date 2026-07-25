import assert from "node:assert/strict";
import { test } from "vitest";
import {
	ALL_TOOLS,
	HOPPER_SEARCH_TOOLS_NAME,
	HOPPER_STATIC_TOOL_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	getAlwaysActiveToolNames,
	getDiscoverableToolNames,
	nearestGroupsForQuery,
	searchToolCatalog,
} from "./catalog.js";

test("catalog has unique tool names and covers ALL_TOOLS", () => {
	const names = HOPPER_STATIC_TOOL_CATALOG.map((entry) => entry.tool.name);
	assert.equal(new Set(names).size, names.length);
	assert.deepEqual(
		ALL_TOOLS.map((tool) => tool.name),
		names,
	);
	assert.equal(ALL_TOOLS.length, 15);
});

test("core and discoverable partitions are disjoint and complete for static tools", () => {
	const always = new Set(getAlwaysActiveToolNames());
	const discoverable = getDiscoverableToolNames();
	assert.deepEqual([...always].sort(), ["gh_get_canvas", "rh_query_objects", "rh_run_script"]);
	for (const name of always) {
		assert.equal(discoverable.has(name), false);
	}
	for (const entry of HOPPER_STATIC_TOOL_CATALOG) {
		if (entry.activation === "always") assert.ok(always.has(entry.tool.name));
		if (entry.activation === "discoverable") assert.ok(discoverable.has(entry.tool.name));
	}
	assert.equal(always.size + discoverable.size, HOPPER_STATIC_TOOL_CATALOG.length);
});

test("searchToolCatalog ranks exact and keyword capability queries", () => {
	const byName = searchToolCatalog("gh_edit_script");
	assert.ok(byName.length > 0);
	assert.equal(byName[0]?.name, "gh_edit_script");

	const byCapability = searchToolCatalog("edit script ports");
	assert.ok(byCapability.some((m) => m.name === "gh_edit_param" || m.name === "gh_edit_script"));

	const wires = searchToolCatalog("connect wires between components");
	assert.equal(wires[0]?.name, "gh_edit_wire");

	const view = searchToolCatalog("viewport camera zoom");
	assert.ok(view.some((m) => m.name === "rh_view_control"));
});

test("searchToolCatalog returns empty matches with nearest groups for nonsense", () => {
	const matches = searchToolCatalog("zzzz unrelated quantum foam");
	assert.equal(matches.length, 0);
	const groups = nearestGroupsForQuery("script csharp python");
	assert.ok(groups.includes("gh-script"));
});

test("capture and search names are documented in catalog helpers", () => {
	assert.equal(RH_CAPTURE_VIEW_CATALOG_ENTRY.tool.name, "rh_capture_view");
	assert.equal(RH_CAPTURE_VIEW_CATALOG_ENTRY.activation, "conditional");
	assert.equal(HOPPER_SEARCH_TOOLS_NAME, "hopper_search_tools");
});

test("discoverable tools omit promptSnippet and promptGuidelines", () => {
	const discoverable = getDiscoverableToolNames();
	for (const entry of HOPPER_STATIC_TOOL_CATALOG) {
		if (!discoverable.has(entry.tool.name)) continue;
		assert.equal(
			entry.tool.promptSnippet,
			undefined,
			`${entry.tool.name} should omit promptSnippet`,
		);
		assert.equal(
			entry.tool.promptGuidelines,
			undefined,
			`${entry.tool.name} should omit promptGuidelines`,
		);
	}
});

test("always-active tools keep promptSnippet for compact Available tools guidance", () => {
	for (const name of getAlwaysActiveToolNames()) {
		const entry = HOPPER_STATIC_TOOL_CATALOG.find((e) => e.tool.name === name);
		assert.ok(entry);
		assert.ok(entry!.tool.promptSnippet, `${name} should keep promptSnippet`);
	}
});
