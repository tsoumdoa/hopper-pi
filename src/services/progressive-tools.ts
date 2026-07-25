import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	HOPPER_SEARCH_TOOLS_NAME,
	getAlwaysActiveToolNames,
	getDiscoverableToolNames,
} from "../tools/catalog.js";

/**
 * Progressive mode: keep discoverable Hopper tools registered but inactive.
 * Preserves built-ins and other extensions' tools; ensures core + loader stay active.
 * Does not touch rh_capture_view — the capture model controller owns that gate.
 */
export function applyProgressiveCoreTools(pi: ExtensionAPI): string[] {
	const discoverable = getDiscoverableToolNames();
	const core = new Set(getAlwaysActiveToolNames());
	core.add(HOPPER_SEARCH_TOOLS_NAME);

	const current = pi.getActiveTools();
	const preserved = current.filter((name) => !discoverable.has(name));
	const next = [...new Set([...preserved, ...core])];

	// Only call setActiveTools when the set actually changes (order-insensitive).
	const currentSet = new Set(current);
	const changed =
		next.length !== current.length || next.some((name) => !currentSet.has(name));
	if (changed) {
		pi.setActiveTools(next);
	}
	return next;
}

/** Names that progressive mode may deactivate on session reset (/new). */
export function isProgressiveDiscoverableTool(name: string): boolean {
	return getDiscoverableToolNames().has(name);
}
