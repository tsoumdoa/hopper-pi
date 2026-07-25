import type { HopperToolCatalogEntry, HopperToolGroup } from "./catalog-types.js";

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 10;
export const MIN_MATCH_SCORE = 15;

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

function keywordMatchesToken(keyword: string, token: string): "exact" | "fuzzy" | null {
	if (keyword === token) return "exact";

	const parts = keyword.split(/\s+/).filter(Boolean);
	for (const part of parts) {
		if (part === token) return "exact";
		// Substring hits only for tokens long enough to be meaningful, so "id" does
		// not match inside "widget". Longer tokens may still match mid-word
		// ("port" inside "viewport"); exact keyword hits outscore those.
		if (token.length >= 4 && part.includes(token)) return "fuzzy";
		if (part.length >= 4 && token.startsWith(part)) return "fuzzy";
	}

	if (token.length >= 4 && keyword.includes(token)) return "fuzzy";
	return null;
}

function scoreEntry(entry: HopperToolCatalogEntry, tokens: string[]): { score: number; reasons: string[] } {
	const name = entry.tool.name.toLowerCase();
	const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());
	const description = entry.tool.description.toLowerCase();
	const group = entry.group.toLowerCase();
	let score = 0;
	const reasons: string[] = [];

	for (const token of tokens) {
		if (name === token || name.replace(/_/g, "") === token.replace(/_/g, "")) {
			score += 100;
			reasons.push(`exact name "${entry.tool.name}"`);
			continue;
		}
		if (name.includes(token) || name.includes(token.replace(/-/g, "_"))) {
			score += 40;
			reasons.push(`name contains "${token}"`);
		}
		for (const keyword of keywords) {
			const match = keywordMatchesToken(keyword, token);
			if (match === "exact") {
				score += 25;
				reasons.push(`keyword "${keyword}"`);
			} else if (match === "fuzzy") {
				score += 15;
				reasons.push(`keyword ~ "${keyword}"`);
			}
		}
		if (group === token || group.includes(token)) {
			score += 10;
			reasons.push(`group "${entry.group}"`);
		}
		// Whole-word-ish description hit: avoid short tokens matching inside unrelated words.
		if (token.length >= 4 && description.includes(token)) {
			score += 5;
			reasons.push(`description mentions "${token}"`);
		}
	}

	return { score, reasons: uniqueSorted(reasons).slice(0, 4) };
}

export function clampSearchLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

/**
 * Deterministic keyword/alias ranking over the Hopper tool catalog.
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
				reason: reasons.join("; ") || `matched query tokens`,
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

	// Nothing cleared MIN_MATCH_SCORE (so `scored` is empty): fall back to raw
	// sub-threshold scores to point at the closest groups.
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
				`Groups: ${(["rhino", "gh-read", "gh-edit", "gh-script", "interaction"] as const).join(", ")}.`,
			],
		},
	};
}
