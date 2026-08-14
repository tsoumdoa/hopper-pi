import { defineTool, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	getAlwaysActiveToolNames,
	getManagedHopperToolNames,
	HOPPER_TOOL_GROUPS,
	type HopperToolCatalogEntry,
	type HopperToolGroup,
} from "./catalog.js";

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 10;
export const MIN_MATCH_SCORE = 15;

export type ProgressiveResetReason = "startup" | "reload" | "new" | "resume" | "fork";

export type ToolSearchMatch = {
	name: string;
	group: HopperToolGroup;
	score: number;
	reason: string;
	requires?: HopperToolCatalogEntry["requires"];
	alwaysActive?: boolean;
};

export type ToolSearchNoMatchHint = {
	nearestGroups: HopperToolGroup[];
	suggestions: string[];
};

export type ActivateSearchMatchesOptions = {
	registeredNames: ReadonlySet<string>;
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

function tokenize(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9_+-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function keywordHitsToken(keyword: string, token: string): "exact" | "prefix" | null {
	if (keyword === token) return "exact";
	const parts = keyword.split(/\s+/).filter(Boolean);
	for (const part of parts) {
		if (part === token) return "exact";
		if (token.length >= 4 && part.startsWith(token)) return "prefix";
		if (part.length >= 4 && token.startsWith(part)) return "prefix";
	}
	return null;
}

function scoreEntry(
	entry: HopperToolCatalogEntry,
	tokens: string[],
): { score: number; reasons: string[] } {
	const name = entry.tool.name.toLowerCase();
	const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());
	let score = 0;
	const reasons: string[] = [];

	for (const token of tokens) {
		const tokenFlat = token.replace(/-/g, "");
		if (name === token || name.replace(/_/g, "") === tokenFlat) {
			score += 100;
			reasons.push(`exact name "${entry.tool.name}"`);
			continue;
		}
		if (token.length >= 4 && (name.includes(token) || name.includes(token.replace(/-/g, "_")))) {
			score += 40;
			reasons.push(`name contains "${token}"`);
		}
		for (const keyword of keywords) {
			const match = keywordHitsToken(keyword, token);
			if (match === "exact") {
				score += 25;
				reasons.push(`keyword "${keyword}"`);
			} else if (match === "prefix") {
				score += 15;
				reasons.push(`keyword ~ "${keyword}"`);
			}
		}
		if (entry.group === token || entry.group.includes(token)) {
			score += 10;
			reasons.push(`group "${entry.group}"`);
		}
	}

	return { score, reasons: uniqueSorted(reasons).slice(0, 4) };
}

export function clampSearchLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

/**
 * Deterministic keyword ranking over the Hopper tool catalog.
 * Does not activate tools; callers decide activation policy.
 */
export function rankHopperTools(
	catalog: readonly HopperToolCatalogEntry[],
	query: string,
	limit?: number,
): { matches: ToolSearchMatch[]; noMatch?: ToolSearchNoMatchHint } {
	const tokens = tokenize(query);
	const cappedLimit = clampSearchLimit(limit);

	if (tokens.length === 0) {
		return {
			matches: [],
			noMatch: {
				nearestGroups: ["interaction", "gh-read", "rhino"],
				suggestions: [
					"Describe a capability (e.g. \"edit script ports\", \"viewport camera\", \"reference rhino geometry\").",
					"Or name a tool / group (e.g. gh_edit_script, gh-script, rhino).",
				],
			},
		};
	}

	const scored = catalog
		.map((entry) => {
			const { score, reasons } = scoreEntry(entry, tokens);
			return {
				entry,
				score,
				reason: reasons.join("; ") || "matched query tokens",
			};
		})
		.filter((row) => row.score >= MIN_MATCH_SCORE)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.entry.tool.name.localeCompare(b.entry.tool.name);
		});

	const matches: ToolSearchMatch[] = scored.slice(0, cappedLimit).map((row) => ({
		name: row.entry.tool.name,
		group: row.entry.group,
		score: row.score,
		reason: row.reason,
		requires: row.entry.requires,
		alwaysActive: row.entry.alwaysActive,
	}));

	if (matches.length > 0) {
		return { matches };
	}

	const groupHits = new Map<HopperToolGroup, number>();
	for (const entry of catalog) {
		const { score } = scoreEntry(entry, tokens);
		groupHits.set(entry.group, (groupHits.get(entry.group) ?? 0) + score);
	}
	const nearestGroups = [...groupHits.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 3)
		.map(([group]) => group);

	return {
		matches: [],
		noMatch: {
			nearestGroups: nearestGroups.length > 0 ? nearestGroups : ["gh-read", "rhino", "gh-edit"],
			suggestions: [
				"Try capability words: script, ports, wire, widget, canvas errors, viewport, screenshot, reference geometry.",
				"Try a tool name fragment: gh_edit_, rh_view, gh_param, apply_graph.",
				`Groups: ${HOPPER_TOOL_GROUPS.join(", ")}.`,
			],
		},
	};
}

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

function formatSearchResultText(
	result: ActivateSearchMatchesResult,
	query: string,
	limit: number,
): string {
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

export function parseProgressiveResetReason(reason: string | undefined): ProgressiveResetReason {
	switch (reason) {
		case "startup":
		case "reload":
		case "new":
		case "resume":
		case "fork":
			return reason;
		default:
			return "startup";
	}
}

/** Reset progressive Hopper specialists on fresh sessions; keep them across resume/fork. */
export function shouldResetProgressiveTools(reason: ProgressiveResetReason): boolean {
	switch (reason) {
		case "startup":
		case "reload":
		case "new":
			return true;
		case "resume":
		case "fork":
			return false;
		default: {
			const _exhaustive: never = reason;
			void _exhaustive;
			return false;
		}
	}
}

/**
 * Replace managed Hopper tools in the active set with the always-on core.
 * Preserves non-Hopper tools (built-ins, choice tools, etc.).
 * Does not force-activate image-gated tools; callers should sync rh_capture_view afterward.
 */
export function resetProgressiveActiveTools(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools" | "getAllTools">,
	catalog: readonly HopperToolCatalogEntry[],
): string[] {
	const managed = getManagedHopperToolNames(catalog);
	const registered = new Set(pi.getAllTools().map((tool) => tool.name));
	const core = getAlwaysActiveToolNames(catalog).filter((name) => registered.has(name));
	const preserved = pi.getActiveTools().filter((name) => !managed.has(name));
	const next = [...preserved, ...core];
	pi.setActiveTools(next);
	return next;
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
			"Only needed when the Hopper tool you want is not already among your active tools; " +
			"if the gh_*/rh_* tool you need is already active, call it directly. " +
			"Activates matches additively for the rest of the session; does not deactivate tools.",
		promptSnippet: "Search and activate specialized Hopper tools by capability",
		promptGuidelines: [
			"Use hopper_search_tools only when a Hopper capability you need (script editing, wiring, widgets, view control, apply graph, Rhino→GH geometry params) has no active tool; skip it when that tool is already active.",
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
