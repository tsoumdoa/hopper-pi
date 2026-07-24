import assert from "node:assert/strict";
import { test } from "vitest";
import { createHopperLoadToolsTool } from "./hopper-load-tools.js";

test("loader adds only requested semantic groups and never removes tools", async () => {
	let active = ["read", "gh_apply_graph", "hopper_load_tools"];
	const tool = createHopperLoadToolsTool({
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			active = names;
		},
	});

	const result = await tool.execute(
		"call-1",
		{ groups: ["script_edits"] },
		new AbortController().signal,
		undefined,
		{} as never,
	);

	assert.ok(active.includes("read"));
	assert.ok(active.includes("gh_edit_script"));
	assert.ok(active.includes("gh_edit_param"));
	assert.ok(!active.includes("gh_edit_wire"));
	assert.deepEqual(result.details.added, ["gh_edit_script", "gh_edit_param"]);
});
