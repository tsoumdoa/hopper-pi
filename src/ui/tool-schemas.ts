import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";

/** Agent-facing tool surface: name, description, JSON Schema parameters, optional guidelines. */
export type AgentToolSchema = {
	name: string;
	description: string;
	parameters: unknown;
	promptGuidelines?: string[];
};

export const VIEW_ALL_LABEL = "All tools (combined JSON)";

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

export function listToolSelectOptions(tools: ToolInfo[]): string[] {
	const names = tools.map((tool) => tool.name).sort((a, b) => a.localeCompare(b));
	return [VIEW_ALL_LABEL, ...names];
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

export function registerToolSchemasUI(pi: ExtensionAPI): void {
	pi.registerCommand("hopper-schemas", {
		description: "Browse JSON schemas exposed to the agent for registered tools",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/hopper-schemas requires an interactive UI", "error");
				return;
			}

			const tools = pi.getAllTools();
			if (tools.length === 0) {
				ctx.ui.notify("No tools are registered", "warning");
				return;
			}

			const requested = args.trim();
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

			await showToolSchema(ctx, tools, choice);
		},
	});
}
