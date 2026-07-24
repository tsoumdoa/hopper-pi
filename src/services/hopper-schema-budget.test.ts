import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
	HOPPER_SCHEMA_BUDGETS,
	HOPPER_CAPTURE_SCHEMA_ROUTES,
	HOPPER_SCHEMA_ROUTES,
	HOPPER_SCHEMA_TOOLS,
	legacySchemaSize,
	renderSchemaSizeReport,
	schemaRouteSizes,
} from "./hopper-schema-budget.js";
import { TypeHintType } from "../tools/edit-tools/shared-types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("active and registered Hopper schema surfaces stay within hard budgets", () => {
	const routes = schemaRouteSizes();
	assert.ok(routes.default <= HOPPER_SCHEMA_BUDGETS.default);
	for (const [name, size] of Object.entries(routes)) {
		const budget = name === "script_edits"
			? HOPPER_SCHEMA_BUDGETS.scriptRoute
			: name === "default" || name === "capture_default"
				? HOPPER_SCHEMA_BUDGETS.default
				: HOPPER_SCHEMA_BUDGETS.normalRoute;
		assert.ok(size <= budget, `${name}: ${size} > ${budget}`);
	}
	assert.ok(legacySchemaSize() <= HOPPER_SCHEMA_BUDGETS.legacy);
	assert.deepEqual(
		Object.keys(routes),
		[...Object.keys(HOPPER_SCHEMA_ROUTES), ...Object.keys(HOPPER_CAPTURE_SCHEMA_ROUTES)],
	);
});

test("committed schema-size report matches generated tool and route totals", () => {
	const committed = readFileSync(join(root, "docs/hopper-schema-sizes.md"), "utf8");
	assert.equal(committed, renderSchemaSizeReport());
});

test("model-facing Hopper descriptions are concise and avoid active prompt snippets", () => {
	for (const tool of HOPPER_SCHEMA_TOOLS) {
		assert.ok(tool.description.length <= 180, `${tool.name} description is too long`);
		assert.equal((tool as { promptSnippet?: string }).promptSnippet, undefined);
	}
});

test("concise tool description snapshot", () => {
	assert.deepEqual(
		Object.fromEntries(HOPPER_SCHEMA_TOOLS.map((tool) => [tool.name, tool.description])),
		{
			rh_run_script: "Run sequential command, Python, or C# items against the active Rhino document; failures do not roll back earlier items.",
			rh_query_objects: "List or count filtered Rhino document objects and return short object IDs.",
			rh_view_control: "Change Rhino viewport, projection, camera, CPlane view, zoom, or named views.",
			gh_apply_graph: "Atomically create a new Grasshopper subgraph with local refs, including components, widgets, scripts, wires, and groups; validation is included.",
			gh_param_rhino: "Get, reference, or internalize Rhino geometry on an existing GH param; use IDs (max 30) or one filtered query.",
			gh_create_widget: "Surgically create a Grasshopper slider, panel, toggle, swatch, scribble, or value list.",
			gh_mutate_widget: "Surgically change an existing Grasshopper widget's value or widget-specific properties.",
			gh_edit_components: "Surgically add, delete, move, rename, lock, or hide Grasshopper canvas objects.",
			gh_edit_param: "Inspect or surgically edit existing Grasshopper script ports; syncParams reconciles complete lists.",
			gh_edit_wire: "Surgically connect or disconnect existing Grasshopper ports by component and port IDs.",
			gh_edit_group: "Surgically create or edit Grasshopper groups using existing object IDs and group names.",
			gh_edit_script: "Surgically create, inspect, or edit Grasshopper C#/Python scripts; C# prefers scriptParts and Python uses full code.",
			gh_get_canvas: "Inspect an existing Grasshopper canvas, subgraph, or current selection.",
			gh_list_components: "Search exact Grasshopper component types when a graph type is unusual, missing, or ambiguous.",
			gh_get_canvas_errors: "Inspect runtime messages and overlap checks on the current Grasshopper canvas.",
			hopper_load_tools: "Add deferred Hopper tool groups when the active tools cannot perform the requested edit.",
			rh_capture_view: "Capture a consent-gated Rhino viewport PNG when the selected model supports images.",
		},
	);
});

test("script schemas advertise canonical type hints only", () => {
	const schema = JSON.stringify(TypeHintType);
	for (const canonical of ["object", "double", "int", "string", "bool"]) {
		assert.match(schema, new RegExp(`"const":"${canonical}"`));
	}
	assert.doesNotMatch(schema, /"const":"integer"/);
	assert.doesNotMatch(schema, /"const":"boolean"/);
});
