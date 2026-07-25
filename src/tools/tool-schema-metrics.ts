import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	HOPPER_STATIC_TOOL_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	type HopperToolCatalogEntry,
	type HopperToolGroup,
} from "./catalog.js";

export type ToolSchemaSize = {
	name: string;
	group: HopperToolGroup;
	activation: HopperToolCatalogEntry["activation"];
	/** Compact JSON bytes for { name, description, parameters }. */
	bytes: number;
	parameterBytes: number;
	descriptionBytes: number;
};

export type GroupSchemaMetrics = {
	group: HopperToolGroup;
	count: number;
	bytes: number;
};

export type ToolSchemaReport = {
	tools: ToolSchemaSize[];
	byGroup: GroupSchemaMetrics[];
	totalCount: number;
	totalBytes: number;
	coreCount: number;
	coreBytes: number;
	discoverableCount: number;
	discoverableBytes: number;
};

export type SchemaMetricTool = Pick<ToolDefinition, "name" | "description" | "parameters">;

export function serializedToolSchemaBytes(tool: SchemaMetricTool): {
	bytes: number;
	parameterBytes: number;
	descriptionBytes: number;
} {
	const description = tool.description ?? "";
	const parametersJson = JSON.stringify(tool.parameters ?? {});
	const compact = JSON.stringify({
		name: tool.name,
		description,
		parameters: tool.parameters ?? {},
	});
	return {
		bytes: Buffer.byteLength(compact, "utf8"),
		parameterBytes: Buffer.byteLength(parametersJson, "utf8"),
		descriptionBytes: Buffer.byteLength(description, "utf8"),
	};
}

export function collectToolSchemaMetrics(
	catalog: readonly HopperToolCatalogEntry[] = [
		...HOPPER_STATIC_TOOL_CATALOG,
		RH_CAPTURE_VIEW_CATALOG_ENTRY,
	],
): ToolSchemaReport {
	const tools: ToolSchemaSize[] = catalog.map((entry) => {
		const sizes = serializedToolSchemaBytes(entry.tool);
		return {
			name: entry.tool.name,
			group: entry.group,
			activation: entry.activation,
			...sizes,
		};
	});

	tools.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

	const groupMap = new Map<HopperToolGroup, GroupSchemaMetrics>();
	for (const tool of tools) {
		const existing = groupMap.get(tool.group);
		if (existing) {
			existing.count += 1;
			existing.bytes += tool.bytes;
		} else {
			groupMap.set(tool.group, { group: tool.group, count: 1, bytes: tool.bytes });
		}
	}

	const byGroup = [...groupMap.values()].sort((a, b) => b.bytes - a.bytes || a.group.localeCompare(b.group));
	const core = tools.filter((t) => t.activation === "always");
	const discoverable = tools.filter((t) => t.activation === "discoverable");

	return {
		tools,
		byGroup,
		totalCount: tools.length,
		totalBytes: tools.reduce((sum, t) => sum + t.bytes, 0),
		coreCount: core.length,
		coreBytes: core.reduce((sum, t) => sum + t.bytes, 0),
		discoverableCount: discoverable.length,
		discoverableBytes: discoverable.reduce((sum, t) => sum + t.bytes, 0),
	};
}

export function formatToolSchemaMetrics(report: ToolSchemaReport): string {
	const lines: string[] = [
		`Hopper tool schemas: ${report.totalCount} tools, ${report.totalBytes} compact bytes`,
		`  always-active core: ${report.coreCount} tools, ${report.coreBytes} bytes`,
		`  discoverable: ${report.discoverableCount} tools, ${report.discoverableBytes} bytes`,
		"",
		"By group:",
	];

	for (const group of report.byGroup) {
		lines.push(`  ${group.group}: ${group.count} tools, ${group.bytes} bytes`);
	}

	lines.push("", "By tool (largest first):");
	for (const tool of report.tools) {
		lines.push(
			`  ${tool.name.padEnd(22)} ${String(tool.bytes).padStart(6)} B  ` +
				`params=${String(tool.parameterBytes).padStart(6)}  [${tool.group}/${tool.activation}]`,
		);
	}

	return lines.join("\n");
}
