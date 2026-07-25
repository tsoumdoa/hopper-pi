import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HopperToolCatalogEntry } from "./catalog-types.js";
import { getAlwaysActiveToolNames, getManagedHopperToolNames } from "./catalog.js";

export type ProgressiveResetReason = "startup" | "reload" | "new" | "resume" | "fork";

/** Reset progressive Hopper specialists on fresh sessions; keep them across resume/fork. */
export function shouldResetProgressiveTools(reason: ProgressiveResetReason): boolean {
	switch (reason) {
		case "startup":
		case "reload":
		case "new":
			return true;
		case "resume":
		case "fork":
			return false;
		default: {
			// Unknown/future reason: keep whatever the model already activated.
			const _exhaustive: never = reason;
			void _exhaustive;
			return false;
		}
	}
}

/**
 * Replace managed Hopper tools in the active set with the always-on core.
 * Preserves non-Hopper tools (built-ins, choice tools, etc.).
 * Does not force-activate image-gated tools; callers should sync rh_capture_view afterward.
 */
export function resetProgressiveActiveTools(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools" | "getAllTools">,
	catalog: readonly HopperToolCatalogEntry[],
): string[] {
	const managed = getManagedHopperToolNames(catalog);
	const registered = new Set(pi.getAllTools().map((tool) => tool.name));
	const core = getAlwaysActiveToolNames(catalog).filter((name) => registered.has(name));
	const preserved = pi.getActiveTools().filter((name) => !managed.has(name));
	const next = [...preserved, ...core];
	pi.setActiveTools(next);
	return next;
}
