import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const HOPPER_DEFAULT_TOOLS = [
	"gh_apply_graph",
	"gh_get_canvas",
	"gh_get_canvas_errors",
	"gh_list_components",
	"hopper_load_tools",
] as const;

export const HOPPER_TOOL_GROUPS = {
	canvas_edits: [
		"gh_edit_components",
		"gh_create_widget",
		"gh_mutate_widget",
		"gh_edit_wire",
		"gh_edit_group",
	],
	script_edits: ["gh_edit_script", "gh_edit_param"],
	rhino_document: ["rh_run_script", "rh_query_objects", "rh_view_control"],
	rhino_references: ["gh_param_rhino"],
} as const;

export type HopperToolGroup = keyof typeof HOPPER_TOOL_GROUPS;

export const HOPPER_ROUTED_TOOL_NAMES = new Set<string>([
	...HOPPER_DEFAULT_TOOLS,
	...Object.values(HOPPER_TOOL_GROUPS).flat(),
]);

const ANAPHORIC_FOLLOW_UP =
	/^\s*(?:now\s+)?(?:move|delete|remove|rename|hide|show|lock|unlock|change|edit|fix|connect|disconnect|group|ungroup|update|adjust|make)\s+(?:it|that|this|those|these|the\s+(?:slider|panel|component|script|group|wire|port))\b/i;

const EXISTING_CANVAS_EDIT =
	/\b(?:move|delete|remove|rename|hide|show|lock|unlock|connect|disconnect|rewire|group|ungroup|change|set|adjust|edit|modify|fix)\b.{0,48}\b(?:canvas|selected|component|widget|wire|group|slider|panel|toggle|swatch|preview)\b/i;

const EXISTING_SCRIPT_EDIT =
	/\b(?:edit|patch|replace|inspect|read|get|change|rename|sync|remove)\b.{0,48}\b(?:existing\s+)?(?:c#|csharp|python|script|code|input port|output port|parameter|param)\b|\badd\b.{0,32}\b(?:input port|output port|parameter|param)\b/i;

const RHINO_REFERENCE =
	/\b(?:reference|internalize|link)\b.{0,64}\b(?:rhino|geometry|object|layer)\b|\bgh_param_rhino\b/i;

const RHINO_DOCUMENT =
	/\b(?:rhino(?:doc| document)?|rhinoscriptsyntax|rhinocommon|layer|viewport|camera|cplane|named view|rh_run_script|rh_query_objects|rh_view_control|direct bake)\b/i;

function uniqueGroups(groups: Iterable<HopperToolGroup>): HopperToolGroup[] {
	return [...new Set(groups)];
}

function enforceRoutedSurfaceBudget(groups: HopperToolGroup[]): HopperToolGroup[] {
	if (
		groups.length > 2 &&
		groups.includes("canvas_edits") &&
		groups.includes("script_edits")
	) {
		// Keep the more specialized script surface. The additive loader remains
		// available when the same turn later needs general canvas mutations.
		return groups.filter((group) => group !== "canvas_edits");
	}
	return groups;
}

export function routeHopperPrompt(
	prompt: string,
	previousGroups: HopperToolGroup[] = [],
): HopperToolGroup[] {
	const groups: HopperToolGroup[] = [];
	if (EXISTING_CANVAS_EDIT.test(prompt)) groups.push("canvas_edits");
	if (EXISTING_SCRIPT_EDIT.test(prompt)) groups.push("script_edits");
	if (RHINO_DOCUMENT.test(prompt)) groups.push("rhino_document");
	if (RHINO_REFERENCE.test(prompt)) groups.push("rhino_references");

	if (groups.length === 0 && ANAPHORIC_FOLLOW_UP.test(prompt)) {
		return uniqueGroups(previousGroups.length > 0 ? previousGroups : ["canvas_edits"]);
	}
	return enforceRoutedSurfaceBudget(uniqueGroups(groups));
}

export function toolsForHopperGroups(groups: HopperToolGroup[]): string[] {
	return [
		...HOPPER_DEFAULT_TOOLS,
		...groups.flatMap((group) => HOPPER_TOOL_GROUPS[group]),
	];
}

export function applyHopperToolRoute(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
	groups: HopperToolGroup[],
): void {
	const nonHopper = pi.getActiveTools().filter((name) => !HOPPER_ROUTED_TOOL_NAMES.has(name));
	pi.setActiveTools([...new Set([...nonHopper, ...toolsForHopperGroups(groups)])]);
}

export function registerHopperToolRouting(pi: ExtensionAPI): void {
	let previousGroups: HopperToolGroup[] = [];

	pi.on("session_start", () => {
		previousGroups = [];
		applyHopperToolRoute(pi, previousGroups);
	});

	pi.on("input", (event) => {
		const active = new Set(pi.getActiveTools());
		const activeGroups = (Object.keys(HOPPER_TOOL_GROUPS) as HopperToolGroup[])
			.filter((group) => HOPPER_TOOL_GROUPS[group].some((name) => active.has(name)));
		const groups = routeHopperPrompt(
			event.text,
			uniqueGroups([...previousGroups, ...activeGroups]),
		);
		if (event.streamingBehavior) {
			const additions = toolsForHopperGroups(groups);
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...additions])]);
		} else {
			applyHopperToolRoute(pi, groups);
		}
		if (!event.streamingBehavior) previousGroups = groups;
		return { action: "continue" };
	});
}
