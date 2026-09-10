import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolPolicyDescriptor } from "../services/tool-policy.js";

export type PluginContext = {
	/** Call immediately before every provider request. Never cache the returned key. */
	admit(name: string, signal?: AbortSignal): Promise<{ apiKey: string }>;
};
export type PluginInstance = {
	tools: ToolDefinition[];
	abortAll(): void;
	abortTool(name: string): void;
};
export type ToolPlugin = {
	id: string;
	name: string;
	description: string;
	defaultEnabled: boolean;
	keywords: string[];
	credential?: { label: string; notice: string };
	inventory: readonly ToolPolicyDescriptor[];
	create(context: PluginContext): PluginInstance;
};

export const BUILTIN_GROUPS = {
	"hopper.rhino": { name: "Rhino", enabled: true },
	"hopper.grasshopper": { name: "Grasshopper", enabled: true },
	"hopper.interaction": { name: "Interaction", enabled: true },
	"hopper.skills": { name: "Skills", enabled: true },
};

export function validatePlugins(plugins: readonly ToolPlugin[]): void {
	const ids = new Set<string>();
	const toolIds = new Set<string>();
	const names = new Set<string>();
	for (const plugin of plugins) {
		if (!/^[a-z][a-z0-9-]*$/.test(plugin.id) || ["hopper", "constructor", "prototype"].includes(plugin.id)
			|| ids.has(plugin.id) || !plugin.name || !plugin.inventory.length) throw new Error("Invalid or duplicate plugin");
		ids.add(plugin.id);
		for (const tool of plugin.inventory) {
			if (tool.owner !== plugin.id || tool.parent !== plugin.id || !tool.id.startsWith(`${plugin.id}.tool.`)
				|| toolIds.has(tool.id) || names.has(tool.name)
				|| (tool.requirements.includes("credential") && !plugin.credential)) throw new Error("Invalid plugin tool declaration");
			toolIds.add(tool.id); names.add(tool.name);
		}
	}
}
