import type { AgentToolsSnapshot, ToolSettingsAction, ToolSettingsResult } from "../../../src/host/protocol.js";

const defaults = (): AgentToolsSnapshot => ({
	tools: [
		{ id: "hopper.tool.rh_document", name: "rh_document", parent: "hopper.rhino", description: "Inspect and manage the Rhino document.", enabled: true, active: true, available: true, status: "active", parameters: { type: "object", properties: { action: { type: "string", enum: ["info", "open", "save"] } } } },
		{ id: "hopper.tool.gh_list_components", name: "gh_list_components", parent: "hopper.grasshopper", description: "List components on the Grasshopper canvas.", enabled: true, active: true, available: true, status: "active", parameters: { type: "object" } },
		{ id: "firecrawl.tool.search", name: "web_search", parent: "firecrawl", description: "Search public webpages with Firecrawl. Returns titles, source URLs, and excerpts.", enabled: true, active: false, available: false, status: "parent-disabled", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10, default: 5 } } } },
		{ id: "firecrawl.tool.fetch", name: "web_fetch", parent: "firecrawl", description: "Read one public webpage as Markdown with Firecrawl.", enabled: true, active: false, available: false, status: "parent-disabled", parameters: { type: "object", required: ["url"], properties: { url: { type: "string" } } } },
	],
	settings: { version: { epoch: "mock-profile", revision: 0 }, parents: [
		{ id: "hopper.rhino", name: "Rhino", enabled: true }, { id: "hopper.grasshopper", name: "Grasshopper", enabled: true }, { id: "firecrawl", name: "Firecrawl", enabled: false, description: "Web search and webpage reading", credential: { label: "Firecrawl API key", notice: "Search queries and requested URLs are sent to Firecrawl and may consume credits on your account.", status: "missing" } },
	] },
});
let snapshot = defaults();

/** UI-only fixture. Discards submitted keys; never uses protected storage or a provider. */
export function mockToolSettings(action?: ToolSettingsAction): AgentToolsSnapshot | ToolSettingsResult {
	if (!action) return structuredClone(snapshot);
	const settings = snapshot.settings!;
	if ("expected" in action && (action.expected.epoch !== settings.version!.epoch || action.expected.revision !== settings.version!.revision)) {
		return { ok: false, code: "conflict", snapshot: structuredClone(snapshot) };
	}
	if (action.type === "reset" || action.type === "repair") {
		const revision = settings.version!.revision + 1;
		snapshot = defaults(); snapshot.settings!.version!.revision = revision;
	} else {
		if (action.type === "patch") {
			const target = action.patch.target === "parents" ? settings.parents : snapshot.tools;
			const gate = target.find(item => item.id === action.patch.id);
			if (gate) gate.enabled = action.patch.enabled;
		} else if (action.type === "credential") {
			const parent = settings.parents.find(parent => parent.id === action.pluginId);
			if (parent?.credential) {
				parent.credential.status = action.action === "remove" ? "missing" : "configured";
				if (action.action === "save-and-enable") parent.enabled = true;
			}
		}
		settings.version!.revision++;
	}
	for (const tool of snapshot.tools) {
		const parent = snapshot.settings!.parents.find(parent => parent.id === tool.parent)!;
		tool.available = !parent.credential || parent.credential.status === "configured";
		tool.active = Boolean(tool.enabled && parent.enabled && tool.available);
		tool.status = !tool.enabled ? "disabled-by-user" : !parent.enabled ? "parent-disabled" : !tool.available ? "api-key-required" : "active";
	}
	return { ok: true, snapshot: structuredClone(snapshot) };
}
