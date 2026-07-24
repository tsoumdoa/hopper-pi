import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	HOPPER_TOOL_GROUPS,
	type HopperToolGroup,
} from "../services/hopper-tool-routing.js";

const Group = Type.Union([
	Type.Literal("canvas_edits"),
	Type.Literal("script_edits"),
	Type.Literal("rhino_document"),
	Type.Literal("rhino_references"),
]);

export function createHopperLoadToolsTool(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
) {
	return defineTool({
		name: "hopper_load_tools",
		label: "Load Hopper Tools",
		description: "Add deferred Hopper tool groups when the active tools cannot perform the requested edit.",
		parameters: Type.Object({
			groups: Type.Array(Group, { minItems: 1, uniqueItems: true }),
		}),
		async execute(_toolCallId, params) {
			const requested = params.groups as HopperToolGroup[];
			const matches = requested.flatMap((group) => HOPPER_TOOL_GROUPS[group]);
			const active = pi.getActiveTools();
			const added = [...new Set(matches.filter((name) => !active.includes(name)))];
			if (added.length > 0) pi.setActiveTools([...active, ...added]);
			return {
				content: [{
					type: "text" as const,
					text: added.length > 0
						? `Loaded Hopper tools: ${added.join(", ")}`
						: "Requested Hopper tools are already active.",
				}],
				details: { groups: requested, added },
			};
		},
	});
}
