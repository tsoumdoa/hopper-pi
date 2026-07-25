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
import type { HopperToolCatalogEntry, HopperToolGroup } from "./catalog-types.js";

/**
 * Tools registered eagerly via `pi.registerTool` in the main Hopper extension.
 * Excludes `rh_capture_view` (model-gated dynamic registration) and
 * `hopper_search_tools` (factory that needs ExtensionAPI).
 */
export const HOPPER_REGISTERED_CATALOG: readonly HopperToolCatalogEntry[] = [
	{
		tool: rhRunScriptTool,
		group: "rhino",
		keywords: [
			"rhino", "script", "python", "csharp", "command", "macro", "geometry",
			"layer", "bake", "material", "block", "document", "rhinodoc",
		],
		alwaysActive: true,
		requires: "backend",
	},
	{
		tool: rhQueryObjectsTool,
		group: "rhino",
		keywords: [
			"rhino", "query", "objects", "ids", "selection", "layer", "count",
			"filter", "guid", "list",
		],
		alwaysActive: true,
		requires: "backend",
	},
	{
		tool: rhViewControlTool,
		group: "rhino",
		keywords: [
			"viewport", "camera", "zoom", "named view", "standard view", "cplane",
			"projection", "perspective", "top", "front", "view control",
		],
		requires: "backend",
	},
	{
		tool: ghApplyGraphTool,
		group: "gh-edit",
		keywords: [
			"apply graph", "subgraph", "create graph", "batch", "wire", "widget",
			"script", "group", "atomic", "build",
		],
		requires: "backend",
	},
	{
		tool: ghParamRhinoTool,
		group: "gh-edit",
		keywords: [
			"param", "rhino geometry", "reference", "internalize", "geometry param",
			"set geometry", "volatile", "persistent",
		],
		requires: "backend",
	},
	{
		tool: ghCreateWidgetTool,
		group: "gh-edit",
		keywords: [
			"widget", "slider", "panel", "toggle", "swatch", "scribble", "value list",
			"create widget",
		],
		requires: "backend",
	},
	{
		tool: ghMutateWidgetTool,
		group: "gh-edit",
		keywords: [
			"mutate widget", "slider value", "panel text", "toggle", "swatch",
			"value list", "edit widget",
		],
		requires: "backend",
	},
	{
		tool: ghEditComponentsTool,
		group: "gh-edit",
		keywords: [
			"component", "add component", "move", "delete", "enable", "preview",
			"nickname", "typeguid",
		],
		requires: "backend",
	},
	{
		tool: ghEditParamTool,
		group: "gh-script",
		keywords: [
			"script ports", "inputs", "outputs", "syncparams", "access", "typehint",
			"port", "parameter", "addinput", "removeinput",
		],
		requires: "backend",
	},
	{
		tool: ghEditWireTool,
		group: "gh-edit",
		keywords: [
			"wire", "connect", "disconnect", "port", "link", "unwire",
		],
		requires: "backend",
	},
	{
		tool: ghEditGroupTool,
		group: "gh-edit",
		keywords: [
			"group", "cluster visual", "border", "color", "organize",
		],
		requires: "backend",
	},
	{
		tool: ghEditScriptTool,
		group: "gh-script",
		keywords: [
			"script component", "csharp", "python", "setcode", "patchcode",
			"scriptparts", "runscript", "getcode", "code",
		],
		requires: "backend",
	},
	{
		tool: ghGetCanvasTool,
		group: "gh-read",
		keywords: [
			"canvas", "inspect", "structure", "guid", "ports", "wires", "selection",
			"subgraph", "read canvas",
		],
		alwaysActive: true,
		requires: "backend",
	},
	{
		tool: ghListComponentsTool,
		group: "gh-read",
		keywords: [
			"list components", "search components", "typeguid", "registry", "vanilla",
			"plugin", "params catalog",
		],
		requires: "backend",
	},
	{
		tool: ghGetCanvasErrorsTool,
		group: "gh-read",
		keywords: [
			"errors", "warnings", "runtime", "overlap", "validate", "messages", "goo",
		],
		requires: "backend",
	},
] as const;

/** Dynamically registered; model/consent gated. Included in catalog for search + diagnostics. */
export const RH_CAPTURE_VIEW_CATALOG_ENTRY: HopperToolCatalogEntry = {
	tool: rhCaptureViewTool,
	group: "rhino",
	keywords: [
		"screenshot", "capture", "viewport image", "visual qa", "png", "picture",
		"see view",
	],
	requires: "images",
};

/** Tools registered eagerly (backend-guarded) in registration order. */
export const ALL_TOOLS = HOPPER_REGISTERED_CATALOG.map((entry) => entry.tool);

export function getAlwaysActiveToolNames(
	catalog: readonly HopperToolCatalogEntry[],
): string[] {
	return catalog.filter((entry) => entry.alwaysActive).map((entry) => entry.tool.name);
}

export function getManagedHopperToolNames(
	catalog: readonly HopperToolCatalogEntry[],
): ReadonlySet<string> {
	return new Set(catalog.map((entry) => entry.tool.name));
}
