import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SEARCH_TOOL_LIMIT } from "../config.js";
import {
	HOPPER_SEARCH_TOOLS_NAME,
	getDiscoverableToolNames,
	nearestGroupsForQuery,
	searchToolCatalog,
	type CatalogSearchMatch,
} from "./catalog.js";

export type HopperSearchToolsDetails = {
	query: string;
	matches: Array<{ name: string; group: string; score: number; reason: string; alreadyActive: boolean }>;
	activated: string[];
	alreadyActive: string[];
	truncated: boolean;
	limit: number;
	nearestGroups?: string[];
	hint?: string;
};

function formatMatchLine(match: CatalogSearchMatch, alreadyActive: boolean, activated: boolean): string {
	const flags = [
		alreadyActive ? "already-active" : null,
		activated ? "activated" : null,
	].filter(Boolean).join(", ");
	return `- ${match.name} [${match.group}] score=${match.score}${flags ? ` (${flags})` : ""} — ${match.reason}`;
}

/**
 * Progressive loader: rank catalog tools for a capability query and activate
 * matches additively via setActiveTools. Never removes active tools.
 */
export function createHopperSearchToolsTool(
	pi: ExtensionAPI,
	options?: { maxActivate?: number },
) {
	const defaultLimit = options?.maxActivate ?? SEARCH_TOOL_LIMIT;

	return defineTool({
		name: HOPPER_SEARCH_TOOLS_NAME,
		label: "Search Hopper Tools",
		description:
			"Find and activate Hopper Rhino/Grasshopper tools for a capability or task query. " +
			"Use when the active Hopper tools cannot perform the needed canvas edit, Rhino view, or geometry-param operation. " +
			"Activates matches additively for the rest of the session.",
		promptSnippet: "Search and activate Hopper tools for a capability that is not currently available",
		promptGuidelines: [
			"Use hopper_search_tools when a Grasshopper edit, Rhino view, geometry-param, or component-search capability is missing from the active tools.",
			"Prefer hopper_search_tools with a short capability phrase (e.g. \"edit script ports\", \"wire components\", \"viewport camera\") rather than guessing tool names.",
			"After hopper_search_tools activates tools, call those tools on the next step; do not remove or replace the active set yourself.",
		],
		parameters: Type.Object({
			query: Type.String({
				minLength: 1,
				description: "Capability or task to search for (not only an exact tool name)",
			}),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 12,
					description: `Max tools to activate this request (default ${defaultLimit})`,
				}),
			),
		}),

		async execute(_toolCallId, params) {
			const limit = Math.min(12, Math.max(1, params.limit ?? defaultLimit));
			const discoverable = getDiscoverableToolNames();
			const ranked = searchToolCatalog(params.query, { limit: Math.max(limit, 8) });

			// Prefer activating discoverable Hopper specialists; still report conditional matches.
			const activatable = ranked.filter((match) => discoverable.has(match.name));
			const selected = activatable.slice(0, limit);
			const truncated = activatable.length > limit;

			const active = pi.getActiveTools();
			const activeSet = new Set(active);
			const toActivate = selected
				.map((match) => match.name)
				.filter((name) => !activeSet.has(name));

			if (toActivate.length > 0) {
				pi.setActiveTools([...active, ...toActivate]);
			}

			const activatedSet = new Set(toActivate);
			const matchRows = ranked.slice(0, Math.max(limit, 5)).map((match) => ({
				name: match.name,
				group: match.group,
				score: match.score,
				reason: match.reason,
				alreadyActive: activeSet.has(match.name),
			}));

			if (selected.length === 0 && ranked.length === 0) {
				const nearestGroups = nearestGroupsForQuery(params.query);
				const hint =
					"Try a more specific capability phrase such as \"edit script\", \"connect wires\", " +
					"\"list components\", \"viewport camera\", \"reference rhino geometry\", or an exact tool name like gh_edit_script.";
				const details: HopperSearchToolsDetails = {
					query: params.query,
					matches: [],
					activated: [],
					alreadyActive: [],
					truncated: false,
					limit,
					nearestGroups,
					hint,
				};
				const groupHint = nearestGroups.length > 0
					? ` Nearest groups: ${nearestGroups.join(", ")}.`
					: "";
				return {
					content: [{
						type: "text" as const,
						text: `No Hopper tools matched "${params.query}".${groupHint} ${hint}`,
					}],
					details,
				};
			}

			const alreadyActiveNames = selected
				.map((m) => m.name)
				.filter((name) => activeSet.has(name));

			const lines = [
				selected.length > 0
					? `Matched ${selected.length} Hopper tool(s) for "${params.query}":`
					: `Found related tools for "${params.query}" but none are progressive discoverable specialists:`,
				...ranked.slice(0, Math.max(selected.length, 5)).map((match) =>
					formatMatchLine(match, activeSet.has(match.name), activatedSet.has(match.name)),
				),
			];

			if (toActivate.length > 0) {
				lines.push(`Activated: ${toActivate.join(", ")}. Call them on the next request.`);
			} else if (selected.length > 0) {
				lines.push(`Already active: ${alreadyActiveNames.join(", ")}.`);
			}

			if (truncated) {
				lines.push(
					`Limit ${limit} applied (${activatable.length} discoverable matches). ` +
						"Re-run hopper_search_tools with a narrower query or a higher limit to load more.",
				);
			}

			const details: HopperSearchToolsDetails = {
				query: params.query,
				matches: matchRows,
				activated: toActivate,
				alreadyActive: alreadyActiveNames,
				truncated,
				limit,
			};

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details,
			};
		},
	});
}
