import type { GhComponentInfo } from "../types/messages.js";
import { toShortTypeGuid } from "./guid-shortener.js";

const MULTI_TOKEN_BONUS = 50;
const MIN_TOKEN_LENGTH = 2;
const DESCRIPTION_TRUNCATE_MAX = 60;

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

function isSubsequence(word: string, token: string): boolean {
	if (token.length < MIN_TOKEN_LENGTH) return false;
	let i = 0;
	for (const ch of word) {
		if (ch === token[i]) i++;
		if (i === token.length) return true;
	}
	return false;
}

export function truncateDescription(description: string): string {
	if (description.length <= DESCRIPTION_TRUNCATE_MAX) return description;
	return description.slice(0, DESCRIPTION_TRUNCATE_MAX - 3) + "...";
}

export function tokenizeQuery(query: string): string[] {
	const tokens: string[] = [];
	for (const part of query.trim().split(/\s+/)) {
		if (!part) continue;
		const camelParts = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
		for (const segment of camelParts) {
			const lower = segment.toLowerCase();
			if (lower.length >= MIN_TOKEN_LENGTH) tokens.push(lower);
		}
	}
	return [...new Set(tokens)];
}

export function scoreComponent(c: GhComponentInfo, token: string): number {
	const query = token.trim().toLowerCase();
	if (!query || query.length < MIN_TOKEN_LENGTH) return 0;

	const name = c.name.toLowerCase();
	const category = c.category.toLowerCase();
	const subcategory = c.subcategory.toLowerCase();
	const description = c.description.toLowerCase();
	const nameWords = name.split(/\s+/);

	if (name === query) return 100;
	if (name.startsWith(query)) return 90;
	if (name.includes(query)) return 80;
	if (query.length >= MIN_TOKEN_LENGTH) {
		for (const word of nameWords) {
			if (word.startsWith(query)) return 75;
		}
		for (const word of nameWords) {
			if (word.includes(query)) return 65;
		}
		for (const word of nameWords) {
			if (isSubsequence(word, query)) return 62;
		}
	}
	if (subcategory === query) return 70;
	if (subcategory.includes(query)) return 60;
	if (category === query) return 50;
	if (category.includes(query)) return 40;
	if (description.includes(query)) return 20;
	return 0;
}

export function scoreComponentQuery(
	c: GhComponentInfo,
	tokens: string[],
): { score: number; matchedTokenCount: number } {
	if (tokens.length === 0) return { score: 0, matchedTokenCount: 0 };

	let total = 0;
	let matchedTokenCount = 0;
	for (const token of tokens) {
		const tokenScore = scoreComponent(c, token);
		if (tokenScore > 0) matchedTokenCount++;
		total += tokenScore;
	}
	if (matchedTokenCount === 0) return { score: 0, matchedTokenCount: 0 };
	if (tokens.length > 1 && matchedTokenCount === tokens.length) {
		total += MULTI_TOKEN_BONUS;
	}
	return { score: total, matchedTokenCount };
}

export function searchMatchedComponents(components: GhComponentInfo[], query: string): GhComponentInfo[] {
	const tokens = tokenizeQuery(query);
	if (tokens.length === 0) return [];

	return components
		.map((component) => {
			const { score, matchedTokenCount } = scoreComponentQuery(component, tokens);
			return { component, score, matchedTokenCount };
		})
		.filter(({ score }) => score > 0)
		.sort((a, b) => {
			const scoreCmp = b.score - a.score;
			if (scoreCmp !== 0) return scoreCmp;
			const tokenCmp = b.matchedTokenCount - a.matchedTokenCount;
			if (tokenCmp !== 0) return tokenCmp;
			return a.component.name.localeCompare(b.component.name);
		})
		.map(({ component }) => component);
}

export function paginate<T>(
	items: T[],
	limit?: number,
	offset?: number,
): { slice: T[]; hasMore: boolean; totalMatched: number } {
	const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const effectiveOffset = Math.max(offset ?? 0, 0);
	const slice = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
	return { slice, hasMore: effectiveOffset + slice.length < items.length, totalMatched: items.length };
}

function sortByCategoryThenName(a: GhComponentInfo, b: GhComponentInfo): number {
	const catCmp = a.category.localeCompare(b.category);
	if (catCmp !== 0) return catCmp;
	const subCmp = a.subcategory.localeCompare(b.subcategory);
	if (subCmp !== 0) return subCmp;
	return a.name.localeCompare(b.name);
}

export function sortedComponents(components: GhComponentInfo[]): GhComponentInfo[] {
	return [...components].sort(sortByCategoryThenName);
}

function groupByCategory(components: GhComponentInfo[]): Map<string, Map<string, GhComponentInfo[]>> {
	const groups = new Map<string, Map<string, GhComponentInfo[]>>();
	for (const c of components) {
		let subMap = groups.get(c.category);
		if (!subMap) {
			subMap = new Map();
			groups.set(c.category, subMap);
		}
		let list = subMap.get(c.subcategory);
		if (!list) {
			list = [];
			subMap.set(c.subcategory, list);
		}
		list.push(c);
	}
	return groups;
}

export function formatGroupedLines(components: GhComponentInfo[]): string {
	const groups = groupByCategory(components);
	const parts: string[] = [];
	for (const [category, subMap] of groups) {
		parts.push(`== ${category} ==`);
		for (const [subcategory, items] of subMap) {
			parts.push(`  === ${subcategory} ===`);
			for (const c of items) {
				const desc = truncateDescription(c.description);
				parts.push(`    ${c.name} [${toShortTypeGuid(c.typeGuid)}]  --  ${desc}`);
			}
		}
	}
	return parts.join("\n");
}

export function pickComponentSummary(c: GhComponentInfo) {
	return {
		typeGuid: toShortTypeGuid(c.typeGuid),
		name: c.name,
		category: c.category,
		subcategory: c.subcategory,
	};
}
