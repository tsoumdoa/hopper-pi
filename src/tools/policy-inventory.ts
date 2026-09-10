import { HOPPER_REGISTERED_CATALOG, RH_CAPTURE_VIEW_CATALOG_ENTRY } from "./catalog.js";
import { assertPolicyInventory, type ToolPolicyDescriptor } from "../services/tool-policy.js";
import { FIRECRAWL_TOOLS } from "../plugins/firecrawl/index.js";

/** Includes registrations outside the main catalog. This inventory does not register tools. */
export const HOPPER_POLICY_INVENTORY: readonly ToolPolicyDescriptor[] = [
	...[...HOPPER_REGISTERED_CATALOG, RH_CAPTURE_VIEW_CATALOG_ENTRY].map(entry => ({
		id: `hopper.tool.${entry.tool.name}`,
		name: entry.tool.name,
		owner: "hopper",
		parent: entry.group === "rhino" ? "hopper.rhino" : "hopper.grasshopper",
		defaultActive: entry.alwaysActive === true || entry.tool.name === "rh_capture_view",
		requirements: entry.tool.name === "rh_capture_view" ? ["backend", "images"] as const
			: entry.requires ? [entry.requires] : [],
	})),
	{ id: "hopper.tool.hopper_search_tools", name: "hopper_search_tools", owner: "hopper", parent: "hopper.interaction", defaultActive: true, requirements: [] },
	{ id: "hopper.tool.ask_user", name: "ask_user", owner: "hopper", parent: "hopper.interaction", defaultActive: true, requirements: ["ui"] },
	{ id: "hopper.tool.pick_option", name: "pick_option", owner: "hopper", parent: "hopper.interaction", defaultActive: true, requirements: ["ui"] },
	// Embedded host only. External Pi's own read tool is unmanaged.
	{ id: "hopper.tool.read_skill", name: "read", owner: "hopper", parent: "hopper.skills", defaultActive: true, requirements: [] },
	...FIRECRAWL_TOOLS,
];

assertPolicyInventory(HOPPER_POLICY_INVENTORY);
