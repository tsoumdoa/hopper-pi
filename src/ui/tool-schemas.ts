import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";

/** Agent-facing tool surface: name, description, JSON Schema parameters, optional guidelines. */
export type AgentToolSchema = {
	name: string;
	description: string;
	parameters: unknown;
	promptGuidelines?: string[];
};

export const VIEW_ALL_LABEL = "All tools (combined JSON)";
export const DUMP_ALL_LABEL = "Dump all to file…";
export const DEFAULT_DUMP_FILENAME = "tool-schemas.json";

export function toAgentToolSchema(tool: ToolInfo): AgentToolSchema {
	const schema: AgentToolSchema = {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
	if (tool.promptGuidelines?.length) {
		schema.promptGuidelines = [...tool.promptGuidelines];
	}
	return schema;
}

export function formatToolSchemaJson(tool: ToolInfo, space: string | number = 2): string {
	return JSON.stringify(toAgentToolSchema(tool), null, space);
}

export function formatAllToolSchemasJson(tools: ToolInfo[], space: string | number = 2): string {
	return JSON.stringify(tools.map(toAgentToolSchema), null, space);
}

export function resolveDumpPath(): string {
	return resolve(process.cwd(), DEFAULT_DUMP_FILENAME);
}

export async function writeToolSchemasFile(tools: ToolInfo[]): Promise<string> {
	const outPath = resolveDumpPath();
	await writeFile(outPath, `${formatAllToolSchemasJson(tools)}\n`, "utf-8");
	return outPath;
}

export function listToolSelectOptions(tools: ToolInfo[]): string[] {
	const names = tools.map((tool) => tool.name).sort((a, b) => a.localeCompare(b));
	return [VIEW_ALL_LABEL, DUMP_ALL_LABEL, ...names];
}

export function resolveToolSchemaSelection(
	tools: ToolInfo[],
	selection: string,
): { title: string; json: string } | undefined {
	if (selection === VIEW_ALL_LABEL || selection === "all") {
		return {
			title: `Agent tool schemas (${tools.length})`,
			json: formatAllToolSchemasJson(tools),
		};
	}

	const tool = tools.find((candidate) => candidate.name === selection);
	if (!tool) return undefined;

	return {
		title: `Schema: ${tool.name}`,
		json: formatToolSchemaJson(tool),
	};
}

async function showToolSchema(ctx: ExtensionContext, tools: ToolInfo[], selection: string): Promise<void> {
	const resolved = resolveToolSchemaSelection(tools, selection);
	if (!resolved) {
		ctx.ui.notify(`Unknown tool: ${selection}`, "error");
		return;
	}

	await ctx.ui.editor(resolved.title, resolved.json);
}

async function dumpToolSchemas(ctx: ExtensionContext, tools: ToolInfo[]): Promise<void> {
	try {
		const outPath = await writeToolSchemasFile(tools);
		ctx.ui.notify(`Wrote ${tools.length} tool schemas → ${outPath}`, "info");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Failed to dump tool schemas: ${message}`, "error");
	}
}

export function registerToolSchemasUI(pi: ExtensionAPI): void {
	pi.registerCommand("hopper-schemas", {
		description:
			"Browse or dump JSON schemas exposed to the agent for registered tools (/hopper-schemas dump → tool-schemas.json)",
		handler: async (args, ctx) => {
			const tools = pi.getAllTools();
			if (tools.length === 0) {
				ctx.ui.notify("No tools are registered", "warning");
				return;
			}

			const tokens = args.trim().split(/\s+/).filter(Boolean);
			if (tokens[0] === "dump") {
				await dumpToolSchemas(ctx, tools);
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("/hopper-schemas browse requires an interactive UI (use dump)", "error");
				return;
			}

			const requested = tokens.join(" ");
			if (requested) {
				await showToolSchema(ctx, tools, requested);
				return;
			}

			const choice = await ctx.ui.select(
				"Tool JSON schema (agent-facing)",
				listToolSelectOptions(tools),
				{ signal: ctx.signal },
			);
			if (!choice) return;

			if (choice === DUMP_ALL_LABEL) {
				await dumpToolSchemas(ctx, tools);
				return;
			}

			await showToolSchema(ctx, tools, choice);
		},
	});
}
