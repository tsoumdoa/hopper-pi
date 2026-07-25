import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { rhRunScriptTool } from "./rh-run-script.js";
import { rhQueryObjectsTool } from "./rh-query-objects.js";
import { rhViewControlTool } from "./rh-view-control.js";
import { rhCaptureViewTool } from "./rh-capture-view.js";
import { ghParamRhinoTool } from "./gh-param-rhino.js";
import {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
} from "./query-tools.js";
import { ghEditComponentsTool } from "./edit-tools/gh-edit-components.js";
import { ghEditParamTool } from "./edit-tools/gh-edit-param.js";
import { ghEditWireTool } from "./edit-tools/gh-edit-wire.js";
import { ghEditGroupTool } from "./edit-tools/gh-edit-group.js";
import { ghCreateWidgetTool } from "./edit-tools/gh-create-widget.js";
import { ghMutateWidgetTool } from "./edit-tools/gh-mutate-widget.js";
import { ghEditScriptTool } from "./edit-tools/gh-edit-script.js";
import { ghApplyGraphTool } from "./gh-apply-graph.js";

export type HopperToolGroup =
	| "rhino"
	| "gh-read"
	| "gh-edit"
	| "gh-script"
	| "interaction";

export type HopperToolRequires = "backend" | "images" | "ui";

export type HopperToolActivation = "always" | "conditional" | "discoverable";

/**
 * Catalog metadata for Hopper tools. `tool` is the definition used for
 * registration and schema metrics; interaction tools owned by the choices
 * extension are listed by name only via {@link INTERACTION_TOOL_CATALOG}.
 */
export type HopperToolCatalogEntry = {
	tool: ToolDefinition;
	group: HopperToolGroup;
	keywords: string[];
	activation: HopperToolActivation;
	requires?: HopperToolRequires;
};

export type InteractionToolCatalogEntry = {
	name: string;
	group: "interaction";
	keywords: string[];
	activation: "conditional";
	requires: "ui";
};

/** Tools registered by the main Hopper extension (excludes loader + capture). */
export const HOPPER_STATIC_TOOL_CATALOG: readonly HopperToolCatalogEntry[] = [
	{
		tool: rhRunScriptTool,
		group: "rhino",
		keywords: [
			"rhino", "document", "script", "python", "csharp", "command", "macro",
			"geometry", "layer", "bake", "material", "block", "undo",
		],
		activation: "always",
		requires: "backend",
	},
	{
		tool: rhQueryObjectsTool,
		group: "rhino",
		keywords: [
			"rhino", "query", "objects", "list", "count", "selection", "layer",
			"objectid", "filter", "ids",
		],
		activation: "always",
		requires: "backend",
	},
	{
		tool: rhViewControlTool,
		group: "rhino",
		keywords: [
			"rhino", "view", "viewport", "camera", "zoom", "named", "standard",
			"cplane", "projection", "perspective",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghApplyGraphTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "apply", "graph", "subgraph", "create", "wire",
			"component", "widget", "script", "batch", "atomic",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghParamRhinoTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "param", "rhino", "geometry", "reference", "internalize",
			"volatile", "persistent", "layer", "selection",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghCreateWidgetTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "widget", "slider", "panel", "toggle", "swatch",
			"scribble", "valuelist", "create",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghMutateWidgetTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "widget", "mutate", "slider", "panel", "toggle",
			"swatch", "scribble", "valuelist", "value", "range",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghEditComponentsTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "component", "add", "delete", "move", "rename",
			"lock", "hide", "preview", "typeguid",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghEditParamTool,
		group: "gh-script",
		keywords: [
			"grasshopper", "script", "port", "param", "input", "output",
			"sync", "access", "typehint", "mapping",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghEditWireTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "wire", "connect", "disconnect", "port", "edge",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghEditGroupTool,
		group: "gh-edit",
		keywords: [
			"grasshopper", "group", "cluster", "color", "border", "organize",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghEditScriptTool,
		group: "gh-script",
		keywords: [
			"grasshopper", "script", "csharp", "python", "code", "patch",
			"runscript", "scriptparts", "create", "edit",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghGetCanvasTool,
		group: "gh-read",
		keywords: [
			"grasshopper", "canvas", "inspect", "structure", "selection",
			"subgraph", "guid", "ports", "wires",
		],
		activation: "always",
		requires: "backend",
	},
	{
		tool: ghListComponentsTool,
		group: "gh-read",
		keywords: [
			"grasshopper", "list", "search", "component", "typeguid", "registry",
			"vanilla", "plugin", "params",
		],
		activation: "discoverable",
		requires: "backend",
	},
	{
		tool: ghGetCanvasErrorsTool,
		group: "gh-read",
		keywords: [
			"grasshopper", "errors", "warnings", "runtime", "overlap", "validate",
			"messages",
		],
		activation: "discoverable",
		requires: "backend",
	},
] as const;

export const RH_CAPTURE_VIEW_CATALOG_ENTRY: HopperToolCatalogEntry = {
	tool: rhCaptureViewTool,
	group: "rhino",
	keywords: [
		"rhino", "capture", "screenshot", "viewport", "image", "visual",
		"qa", "png",
	],
	activation: "conditional",
	requires: "images",
};

/** Interaction tools registered by the choices extension (not main ALL_TOOLS). */
export const INTERACTION_TOOL_CATALOG: readonly InteractionToolCatalogEntry[] = [
	{
		name: "ask_user",
		group: "interaction",
		keywords: ["ask", "question", "clarify", "user", "input", "text"],
		activation: "conditional",
		requires: "ui",
	},
	{
		name: "pick_option",
		group: "interaction",
		keywords: ["pick", "option", "choice", "select", "user", "menu"],
		activation: "conditional",
		requires: "ui",
	},
] as const;

export const HOPPER_SEARCH_TOOLS_NAME = "hopper_search_tools";

/** Static Hopper tools in registration order (excludes loader + capture). */
export const ALL_TOOLS = HOPPER_STATIC_TOOL_CATALOG.map((entry) => entry.tool);

export function getCatalogEntryByName(name: string): HopperToolCatalogEntry | undefined {
	if (name === RH_CAPTURE_VIEW_CATALOG_ENTRY.tool.name) {
		return RH_CAPTURE_VIEW_CATALOG_ENTRY;
	}
	return HOPPER_STATIC_TOOL_CATALOG.find((entry) => entry.tool.name === name);
}

export function getAlwaysActiveToolNames(): string[] {
	return HOPPER_STATIC_TOOL_CATALOG
		.filter((entry) => entry.activation === "always")
		.map((entry) => entry.tool.name);
}

export function getDiscoverableToolNames(): Set<string> {
	return new Set(
		HOPPER_STATIC_TOOL_CATALOG
			.filter((entry) => entry.activation === "discoverable")
			.map((entry) => entry.tool.name),
	);
}

export type CatalogSearchMatch = {
	name: string;
	group: HopperToolGroup;
	score: number;
	reason: string;
};

function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9_+-]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

function scoreEntry(
	name: string,
	group: HopperToolGroup,
	keywords: readonly string[],
	description: string,
	terms: string[],
): CatalogSearchMatch | null {
	if (terms.length === 0) return null;

	const nameLower = name.toLowerCase();
	const descLower = description.toLowerCase();
	const keywordSet = keywords.map((k) => k.toLowerCase());
	const reasons: string[] = [];
	let score = 0;

	for (const term of terms) {
		if (nameLower === term || nameLower.replace(/_/g, "") === term.replace(/_/g, "")) {
			score += 12;
			reasons.push(`exact name "${name}"`);
			continue;
		}
		if (nameLower.includes(term)) {
			score += 8;
			reasons.push(`name contains "${term}"`);
			continue;
		}
		const keywordHit = keywordSet.find((k) => k === term || k.includes(term) || term.includes(k));
		if (keywordHit) {
			score += keywordHit === term ? 6 : 4;
			reasons.push(`keyword "${keywordHit}"`);
			continue;
		}
		if (group.includes(term) || term === "gh" && group.startsWith("gh")) {
			score += 3;
			reasons.push(`group ${group}`);
			continue;
		}
		if (descLower.includes(term)) {
			score += 1;
			reasons.push(`description mentions "${term}"`);
		}
	}

	if (score <= 0) return null;
	return {
		name,
		group,
		score,
		reason: reasons.slice(0, 3).join("; "),
	};
}

/** Rank catalog tools for a capability/task query (deterministic keyword/alias match). */
export function searchToolCatalog(
	query: string,
	options?: { limit?: number; includeCapture?: boolean },
): CatalogSearchMatch[] {
	const terms = tokenizeQuery(query);
	const limit = Math.max(1, Math.min(options?.limit ?? 8, 20));
	const matches: CatalogSearchMatch[] = [];

	for (const entry of HOPPER_STATIC_TOOL_CATALOG) {
		const match = scoreEntry(
			entry.tool.name,
			entry.group,
			entry.keywords,
			entry.tool.description,
			terms,
		);
		if (match) matches.push(match);
	}

	if (options?.includeCapture !== false) {
		const capture = RH_CAPTURE_VIEW_CATALOG_ENTRY;
		const match = scoreEntry(
			capture.tool.name,
			capture.group,
			capture.keywords,
			capture.tool.description,
			terms,
		);
		if (match) matches.push(match);
	}

	for (const entry of INTERACTION_TOOL_CATALOG) {
		const match = scoreEntry(entry.name, entry.group, entry.keywords, entry.name, terms);
		if (match) matches.push(match);
	}

	matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	return matches.slice(0, limit);
}

export function nearestGroupsForQuery(query: string): HopperToolGroup[] {
	const terms = tokenizeQuery(query);
	const groupScores = new Map<HopperToolGroup, number>();

	for (const entry of HOPPER_STATIC_TOOL_CATALOG) {
		for (const term of terms) {
			const hit = entry.keywords.some((k) => k.includes(term) || term.includes(k))
				|| entry.group.includes(term)
				|| entry.tool.name.includes(term);
			if (hit) {
				groupScores.set(entry.group, (groupScores.get(entry.group) ?? 0) + 1);
			}
		}
	}

	return [...groupScores.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 3)
		.map(([group]) => group);
}
