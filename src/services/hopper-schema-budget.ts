import { ALL_TOOLS } from "../tools/index.js";
import { createHopperLoadToolsTool } from "../tools/hopper-load-tools.js";
import { rhCaptureViewTool } from "../tools/rh-capture-view.js";
import {
	HOPPER_TOOL_GROUPS,
	toolsForHopperGroups,
	type HopperToolGroup,
} from "./hopper-tool-routing.js";

type SchemaTool = {
	name: string;
	description: string;
	parameters: unknown;
};

const loader = createHopperLoadToolsTool({
	getActiveTools: () => [],
	setActiveTools: () => {},
});

export const HOPPER_SCHEMA_TOOLS: SchemaTool[] = [...ALL_TOOLS, loader, rhCaptureViewTool];

export const HOPPER_SCHEMA_ROUTES: Record<string, HopperToolGroup[]> = {
	default: [],
	canvas_edits: ["canvas_edits"],
	script_edits: ["script_edits"],
	rhino_document: ["rhino_document"],
	rhino_references: ["rhino_references"],
	mixed_canvas_script: ["canvas_edits", "script_edits"],
	mixed_canvas_rhino: ["canvas_edits", "rhino_document", "rhino_references"],
	mixed_script_rhino: ["script_edits", "rhino_document", "rhino_references"],
};

export const HOPPER_CAPTURE_SCHEMA_ROUTES = {
	capture_default: "default",
	capture_mixed_canvas_script: "mixed_canvas_script",
	capture_mixed_script_rhino: "mixed_script_rhino",
} as const;

export const HOPPER_SCHEMA_BUDGETS = {
	default: 12_000,
	normalRoute: 18_000,
	scriptRoute: 22_000,
	legacy: 36_000,
} as const;

export const LEGACY_SCHEMA_BASELINE = 42_508;

export function schemaCharacters(tool: SchemaTool): number {
	return tool.description.length + JSON.stringify(tool.parameters).length;
}

export function schemaSizeByTool(): Record<string, number> {
	return Object.fromEntries(
		HOPPER_SCHEMA_TOOLS.map((tool) => [tool.name, schemaCharacters(tool)]),
	);
}

export function schemaSizeForNames(names: Iterable<string>): number {
	const sizes = schemaSizeByTool();
	return [...new Set(names)].reduce((total, name) => total + (sizes[name] ?? 0), 0);
}

export function schemaRouteSizes(): Record<string, number> {
	const routes = Object.fromEntries(
		Object.entries(HOPPER_SCHEMA_ROUTES).map(([name, groups]) => [
			name,
			schemaSizeForNames(toolsForHopperGroups(groups)),
		]),
	);
	const captureSize = schemaSizeForNames(["rh_capture_view"]);
	return {
		...routes,
		...Object.fromEntries(
			Object.entries(HOPPER_CAPTURE_SCHEMA_ROUTES).map(([name, base]) => [
				name,
				routes[base] + captureSize,
			]),
		),
	};
}

export function legacySchemaSize(): number {
	return schemaSizeForNames(
		ALL_TOOLS
			.map((tool) => tool.name)
			.filter((name) => name !== "gh_apply_graph"),
	);
}

export function renderSchemaSizeReport(): string {
	const toolSizes = schemaSizeByTool();
	const routeSizes = schemaRouteSizes();
	const lines = [
		"# Hopper Tool Schema Sizes",
		"",
		"Generated with `description.length + JSON.stringify(parameters).length`.",
		"",
		"## Tools",
		"",
		"| Tool | Characters |",
		"|------|-----------:|",
		...Object.entries(toolSizes).map(([name, size]) => `| \`${name}\` | ${size.toLocaleString("en-US")} |`),
		"",
		"## Active routes",
		"",
		"| Route | Characters | Budget |",
		"|-------|-----------:|-------:|",
		...Object.entries(routeSizes).map(([name, size]) => {
			const budget = name === "default" || name === "capture_default"
				? HOPPER_SCHEMA_BUDGETS.default
				: name === "script_edits"
					? HOPPER_SCHEMA_BUDGETS.scriptRoute
					: HOPPER_SCHEMA_BUDGETS.normalRoute;
			return `| \`${name}\` | ${size.toLocaleString("en-US")} | ${budget.toLocaleString("en-US")} |`;
		}),
		"",
		`Legacy definitions combined: ${legacySchemaSize().toLocaleString("en-US")} / ${HOPPER_SCHEMA_BUDGETS.legacy.toLocaleString("en-US")}.`,
		`Pre-refactor legacy baseline: ${LEGACY_SCHEMA_BASELINE.toLocaleString("en-US")} characters.`,
		"",
	];
	return lines.join("\n");
}
