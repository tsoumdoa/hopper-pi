import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { HopperToolCatalogEntry } from "./catalog-types.js";
import {
	clampSearchLimit,
	DEFAULT_SEARCH_LIMIT,
	MAX_SEARCH_LIMIT,
	rankHopperTools,
	type ToolSearchMatch,
	type ToolSearchNoMatchHint,
} from "./search-ranking.js";

export type ActivateSearchMatchesOptions = {
	/** Names that may be activated (must already be registered with Pi). */
	registeredNames: ReadonlySet<string>;
	/** Soft cap on newly activated tools this call. */
	limit?: number;
};

export type ActivateSearchMatchesResult = {
	matches: ToolSearchMatch[];
	added: string[];
	alreadyActive: string[];
	skippedUnregistered: string[];
	truncated: boolean;
	noMatch?: ToolSearchNoMatchHint;
};

/**
 * Rank catalog tools for a capability query and activate matches additively.
 * Never removes currently active tools.
 */
export function activateSearchMatches(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
	catalog: readonly HopperToolCatalogEntry[],
	query: string,
	options: ActivateSearchMatchesOptions,
): ActivateSearchMatchesResult {
	const limit = clampSearchLimit(options.limit);
	const ranked = rankHopperTools(catalog, query, Math.max(limit * 3, MAX_SEARCH_LIMIT));
	const active = pi.getActiveTools();
	const activeSet = new Set(active);

	if (ranked.matches.length === 0) {
		return {
			matches: [],
			added: [],
			alreadyActive: [],
			skippedUnregistered: [],
			truncated: false,
			noMatch: ranked.noMatch,
		};
	}

	const added: string[] = [];
	const alreadyActive: string[] = [];
	const skippedUnregistered: string[] = [];
	const reportedMatches: ToolSearchMatch[] = [];
	let truncated = false;

	for (const match of ranked.matches) {
		if (activeSet.has(match.name)) {
			reportedMatches.push(match);
			alreadyActive.push(match.name);
			continue;
		}

		if (!options.registeredNames.has(match.name)) {
			reportedMatches.push(match);
			skippedUnregistered.push(match.name);
			continue;
		}

		if (added.length >= limit) {
			truncated = true;
			break;
		}

		reportedMatches.push(match);
		added.push(match.name);
	}

	if (added.length > 0) {
		pi.setActiveTools([...active, ...added]);
	}

	return {
		matches: reportedMatches,
		added,
		alreadyActive,
		skippedUnregistered,
		truncated,
		noMatch: ranked.noMatch,
	};
}

function formatSearchResultText(result: ActivateSearchMatchesResult, query: string, limit: number): string {
	if (result.matches.length === 0) {
		const groups = result.noMatch?.nearestGroups?.join(", ") ?? "(none)";
		const hints = (result.noMatch?.suggestions ?? []).map((hint) => `- ${hint}`).join("\n");
		return [
			`No Hopper tools matched query ${JSON.stringify(query)}.`,
			`Nearest groups: ${groups}`,
			"Try a more specific capability query:",
			hints,
		].join("\n");
	}

	const lines = [
		`Matched ${result.matches.length} tool(s) for ${JSON.stringify(query)}:`,
		...result.matches.map((match) => {
			const flags: string[] = [];
			if (result.added.includes(match.name)) flags.push("activated");
			else if (result.alreadyActive.includes(match.name)) flags.push("already active");
			else if (result.skippedUnregistered.includes(match.name)) {
				flags.push(
					match.requires === "images"
						? "unavailable (needs multimodal model / rh_capture_view registration)"
						: "unavailable (not registered)",
				);
			}
			const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
			return `- ${match.name} (${match.group}, score ${match.score})${flagText}: ${match.reason}`;
		}),
	];

	if (result.added.length > 0) {
		lines.push(`Newly activated: ${result.added.join(", ")}. Call them on the next request.`);
	}
	if (result.truncated) {
		lines.push(
			`Activation capped at ${limit} new tools this call; refine the query or search again for more.`,
		);
	}
	return lines.join("\n");
}

export function createHopperSearchToolsTool(
	pi: ExtensionAPI,
	getCatalog: () => readonly HopperToolCatalogEntry[],
): ToolDefinition {
	return defineTool({
		name: "hopper_search_tools",
		label: "Search Hopper Tools",
		description:
			"Find and activate additional Hopper tools by capability or task (not only by exact tool name). " +
			"Use when the active core cannot perform a Grasshopper edit, script, view, geometry-param, or related task. " +
			"Activates matches additively for the rest of the session; does not deactivate tools.",
		promptSnippet: "Search and activate specialized Hopper tools by capability",
		promptGuidelines: [
			"Use hopper_search_tools when you need a Hopper capability that is not in the active core (for example script editing, wiring, widgets, view control, canvas errors, or Rhino→GH geometry params).",
			"After hopper_search_tools activates tools, call those tools on the next request; do not assume they were callable in the same turn.",
			"Prefer hopper_search_tools with a short capability phrase over guessing inactive tool names.",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					"Capability or task to find tools for (e.g. \"edit script ports\", \"viewport camera\", \"reference rhino geometry\").",
				minLength: 1,
			}),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: MAX_SEARCH_LIMIT,
					description: `Max tools to activate from matches (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const catalog = getCatalog();
			const registeredNames = new Set(pi.getAllTools().map((tool) => tool.name));
			const limit = clampSearchLimit(params.limit);
			const result = activateSearchMatches(pi, catalog, params.query, {
				registeredNames,
				limit,
			});
			return {
				content: [{ type: "text" as const, text: formatSearchResultText(result, params.query, limit) }],
				details: result,
			};
		},
	});
}
