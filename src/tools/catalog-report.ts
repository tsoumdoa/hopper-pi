import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HopperToolCatalogEntry, HopperToolGroup } from "./catalog-types.js";

export type ToolSchemaSize = {
	name: string;
	group: HopperToolGroup;
	alwaysActive: boolean;
	requires?: HopperToolCatalogEntry["requires"];
	descriptionBytes: number;
	parametersBytes: number;
	promptSnippetBytes: number;
	promptGuidelinesBytes: number;
	totalBytes: number;
};

export type CatalogSizeReport = {
	toolCount: number;
	alwaysActiveCount: number;
	discoverableCount: number;
	totalBytes: number;
	byGroup: Record<HopperToolGroup, { count: number; totalBytes: number }>;
	tools: ToolSchemaSize[];
};

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function measurePromptGuidelines(guidelines: string[] | undefined): number {
	if (!guidelines?.length) return 0;
	return utf8Bytes(JSON.stringify(guidelines));
}

/** Compact JSON size of a tool's model-facing schema pieces. */
export function measureToolSchemaSize(
	entry: HopperToolCatalogEntry,
): ToolSchemaSize {
	const tool = entry.tool as ToolDefinition & {
		promptSnippet?: string;
		promptGuidelines?: string[];
	};
	const descriptionBytes = utf8Bytes(tool.description ?? "");
	const parametersBytes = utf8Bytes(JSON.stringify(tool.parameters ?? {}));
	const promptSnippetBytes = utf8Bytes(tool.promptSnippet ?? "");
	const promptGuidelinesBytes = measurePromptGuidelines(tool.promptGuidelines);
	return {
		name: tool.name,
		group: entry.group,
		alwaysActive: entry.alwaysActive === true,
		requires: entry.requires,
		descriptionBytes,
		parametersBytes,
		promptSnippetBytes,
		promptGuidelinesBytes,
		totalBytes: descriptionBytes + parametersBytes + promptSnippetBytes + promptGuidelinesBytes,
	};
}

export function buildCatalogSizeReport(
	catalog: readonly HopperToolCatalogEntry[],
): CatalogSizeReport {
	const tools = catalog.map(measureToolSchemaSize).sort((a, b) => {
		if (b.totalBytes !== a.totalBytes) return b.totalBytes - a.totalBytes;
		return a.name.localeCompare(b.name);
	});
	const byGroup = {
		rhino: { count: 0, totalBytes: 0 },
		"gh-read": { count: 0, totalBytes: 0 },
		"gh-edit": { count: 0, totalBytes: 0 },
		"gh-script": { count: 0, totalBytes: 0 },
		interaction: { count: 0, totalBytes: 0 },
	} satisfies Record<HopperToolGroup, { count: number; totalBytes: number }>;

	for (const tool of tools) {
		const row = byGroup[tool.group];
		row.count += 1;
		row.totalBytes += tool.totalBytes;
	}

	return {
		toolCount: tools.length,
		alwaysActiveCount: tools.filter((tool) => tool.alwaysActive).length,
		discoverableCount: tools.filter((tool) => !tool.alwaysActive).length,
		totalBytes: tools.reduce((sum, tool) => sum + tool.totalBytes, 0),
		byGroup,
		tools,
	};
}

export function formatCatalogSizeReport(report: CatalogSizeReport): string {
	const lines = [
		`Hopper tool catalog: ${report.toolCount} tools, ${report.totalBytes} bytes compact schema`,
		`Always-active: ${report.alwaysActiveCount}; discoverable/conditional: ${report.discoverableCount}`,
		"",
		"By group:",
	];
	for (const group of Object.keys(report.byGroup) as HopperToolGroup[]) {
		const row = report.byGroup[group];
		lines.push(`  ${group}: ${row.count} tools, ${row.totalBytes} bytes`);
	}
	lines.push("", "By tool (largest first):");
	for (const tool of report.tools) {
		const flags = [
			tool.alwaysActive ? "core" : "discoverable",
			tool.requires ? `requires=${tool.requires}` : null,
		].filter(Boolean);
		lines.push(
			`  ${tool.name}  ${tool.totalBytes} B  (${tool.group}; ${flags.join(", ")})` +
				`  desc=${tool.descriptionBytes} params=${tool.parametersBytes}` +
				` snippet=${tool.promptSnippetBytes} guidelines=${tool.promptGuidelinesBytes}`,
		);
	}
	return lines.join("\n");
}
