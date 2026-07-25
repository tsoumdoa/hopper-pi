import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	collectToolSchemaMetrics,
	formatToolSchemaMetrics,
} from "../tools/tool-schema-metrics.js";
import { HOPPER_SEARCH_TOOLS_NAME } from "../tools/catalog.js";
import { createHopperSearchToolsTool } from "../tools/hopper-search-tools.js";
import { PROGRESSIVE_TOOLS_ENABLED } from "../config.js";

export function registerToolSchemaMetricsUI(pi: ExtensionAPI): void {
	pi.registerCommand("hopper-tool-sizes", {
		description:
			"Report Hopper catalog tool counts and compact JSON schema sizes by group (/hopper-tool-sizes)",
		handler: async (_args, ctx) => {
			const report = collectToolSchemaMetrics();
			const text = formatToolSchemaMetrics(report);
			if (ctx.hasUI) {
				await ctx.ui.editor("Hopper tool schema sizes", text);
			} else {
				ctx.ui.notify(text, "info");
			}
		},
	});
}

/** Register the progressive loader tool when the feature flag is on. */
export function registerProgressiveSearchTool(pi: ExtensionAPI): void {
	if (!PROGRESSIVE_TOOLS_ENABLED) return;
	const already = pi.getAllTools().some((tool) => tool.name === HOPPER_SEARCH_TOOLS_NAME);
	if (already) return;
	pi.registerTool(createHopperSearchToolsTool(pi));
}
