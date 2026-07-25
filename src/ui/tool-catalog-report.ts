import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HopperToolCatalogEntry } from "../tools/catalog-types.js";
import {
	buildCatalogSizeReport,
	formatCatalogSizeReport,
} from "../tools/catalog-report.js";

export function registerToolCatalogReportUI(
	pi: ExtensionAPI,
	getCatalog: () => readonly HopperToolCatalogEntry[],
): void {
	pi.registerCommand("hopper-tool-catalog", {
		description:
			"Report Hopper tool catalog counts and compact schema sizes by group/tool (/hopper-tool-catalog)",
		handler: async (_args, ctx) => {
			const report = buildCatalogSizeReport(getCatalog());
			const text = formatCatalogSizeReport(report);
			if (ctx.hasUI) {
				await ctx.ui.editor("Hopper tool catalog sizes", text);
				return;
			}
			ctx.ui.notify(text, "info");
		},
	});
}
