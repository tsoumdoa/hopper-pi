import type {
	GetCanvasErrorsResponse,
	GetScriptCodeResponse,
	GhComponentInfo,
	ListAllComponentsResponse,
	ListScriptParamsResponse,
} from "../types/messages.js";
import {
	formatComponentLines,
	paginate,
	pickComponentSummary,
	searchMatchedComponents,
	sortedComponents,
} from "../services/component-search.js";
import {
	formatPythonTreeConversionHint,
	hasGooConversionError,
} from "../services/python-tree-error-hints.js";
import { formatOverlapResult } from "./canvas-checks.js";
import type { CanvasOverlapResult } from "./canvas-checks.js";
import { EXCLUDED_TYPE_GUIDS, VANILLA_CATEGORIES, BLACKLISTED_SUBCATEGORIES } from "./constants.js";

const WIDGET_KEYWORDS: ReadonlyMap<string, string> = new Map([
	["number slider", "slider"],
	["slider", "slider"],
	["panel", "panel"],
	["toggle", "toggle"],
	["swatch", "swatch"],
	["scribble", "scribble"],
	["valuelist", "valueList"],
	["value list", "valueList"],
]);

const PARAMS_KEYWORDS: ReadonlySet<string> = new Set([
	"curve", "mesh", "brep", "point", "geometry", "vector",
	"plane", "data", "number", "text",
]);

export function formatScriptParamsResponse(response: ListScriptParamsResponse) {
	const lines: string[] = [];

	if (response.inputs.length > 0) {
		lines.push("INPUTS:");
		for (const p of response.inputs) {
			lines.push(`  ${p.name} [typeHint=${p.typeHint}, ${p.access}, ${p.dataMapping}, simplify=${p.simplify}, reverse=${p.reverse}]`);
		}
	}

	if (response.outputs.length > 0) {
		lines.push("OUTPUTS:");
		for (const p of response.outputs) {
			lines.push(`  ${p.name} [typeHint=${p.typeHint}, ${p.access}, ${p.dataMapping}, simplify=${p.simplify}, reverse=${p.reverse}]`);
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: response,
	};
}

export function formatScriptCodeResponse(response: GetScriptCodeResponse) {
	return {
		content: [{ type: "text" as const, text: response.code }],
		details: { code: response.code },
	};
}

function isBlacklisted(c: GhComponentInfo): boolean {
	return BLACKLISTED_SUBCATEGORIES.some(
		(e) => e.category === c.category && e.subcategory === c.subcategory,
	);
}

export function formatComponentsMultiQuery(
	response: ListAllComponentsResponse,
	queries?: string[],
	limit?: number,
	offset?: number,
	searchFrom: string = "vanilla",
) {
	const all = response.components
		.filter((c) => !EXCLUDED_TYPE_GUIDS.includes(c.typeGuid))
		.filter((c) => !isBlacklisted(c))
		.filter((c) => {
			if (searchFrom === "params") return c.category === "Params";
			if (searchFrom === "plugin") return !VANILLA_CATEGORIES.has(c.category);
			return VANILLA_CATEGORIES.has(c.category) && c.category !== "Params";
		});
	const sorted = sortedComponents(all);
	const normalizedOffset = Math.max(Math.trunc(offset ?? 0), 0);

	if (!queries || queries.length === 0) {
		const { slice, hasMore, totalMatched } = paginate(sorted, limit, normalizedOffset);
		const body = formatComponentLines(slice);
		const footer = hasMore ? `\n  ... ${totalMatched - normalizedOffset - slice.length} more (call with offset=${normalizedOffset + slice.length})` : "";
		return {
			content: [{ type: "text" as const, text: `All components (${totalMatched}, showing ${slice.length}):${footer}\n${body}` }],
			details: { results: [], totalAvailable: all.length, hasMore },
		};
	}

	const sections: string[] = [];
	const results: Array<{ queryKeyword: string; result: Array<Record<string, unknown>>; hasMore: boolean; totalMatched: number }> = [];

	for (const q of queries) {
		const matched = searchMatchedComponents(all, q);
		const { slice, hasMore, totalMatched } = paginate(matched, limit, normalizedOffset);
		results.push({ queryKeyword: q, result: slice.map(pickComponentSummary), hasMore, totalMatched });

		if (matched.length === 0) {
			sections.push(`"${q}" — no matches`);
		} else {
			const showRange = `showing ${normalizedOffset + 1}-${normalizedOffset + slice.length}`;
			const footer = hasMore ? `\n  ... ${totalMatched - normalizedOffset - slice.length} more (call with offset=${normalizedOffset + slice.length})` : "";
			const body = formatComponentLines(slice);
			sections.push(`"${q}" (${totalMatched} matches, ${showRange}):${footer}\n${body}`);
		}
	}

	const hints: string[] = [];

	const matchedWidgets = new Set<string>();
	for (const q of queries) {
		const ql = q.toLowerCase();
		for (const [keyword, widgetType] of WIDGET_KEYWORDS) {
			if (ql.includes(keyword)) matchedWidgets.add(widgetType);
		}
	}
	if (matchedWidgets.size > 0) {
		const types = [...matchedWidgets].join(", ");
		hints.push(
			`Search hint: ${types} are UI widgets, not standard Grasshopper components. Do not use a componentType from this search to create them. Use gh_create_widget instead, with widgetType set to one of: slider, panel, toggle, swatch, scribble, valueList.`,
		);
	}

	if (searchFrom === "vanilla") {
		const ql = queries.map((q) => q.toLowerCase());
		const matchedParams = [...PARAMS_KEYWORDS].filter((k) => ql.some((q) => q.includes(k)));
		if (matchedParams.length > 0) {
			hints.push(
				`Search hint: this search is currently limited to vanilla components, which excludes Params. Queries mention likely parameter types (${matchedParams.join(", ")}). If you need a standalone parameter component, call gh_list_components again with searchFrom: "params" and the same queries.`,
			);
		}
	}

	const mainText = `Components search (${queries.length} queries, ${all.length} available):\n\n${sections.join("\n\n")}`;
	const hintText = hints.length > 0 ? `\n\n${hints.join("\n")}` : "";

	return {
		content: [{ type: "text" as const, text: mainText + hintText }],
		details: { results, totalAvailable: all.length },
	};
}

export function formatCanvasErrorsResponse(response: GetCanvasErrorsResponse, overlapResult?: CanvasOverlapResult) {
	const errors = response.errors;
	const errorCount = errors.length;

	const lines: string[] = [];

	if (errorCount === 0) {
		lines.push(`Canvas "${response.docName}": no errors or warnings.`);
	} else {
		lines.push(
			`Canvas "${response.docName}": ${errorCount} error(s)/warning(s):`,
			"",
		);

		for (const err of errors) {
			const levelIcon = err.level === "error" ? "❌" : err.level === "warning" ? "⚠️" : "ℹ️";
			lines.push(`${levelIcon} [${err.level}] ${err.componentNickName} (${err.componentId})`);
			lines.push(`   ${err.text}`);
			lines.push("");
		}

		if (hasGooConversionError(errors)) {
			lines.push("--- Python tree/list hint ---");
			lines.push(formatPythonTreeConversionHint());
			lines.push("");
		}
	}

	if (overlapResult) {
		if (lines.length > 0 && !lines[lines.length - 1].match(/^\s*$/)) lines.push("");
		const overlapLines = formatOverlapResult(overlapResult);
		lines.push(`--- Overlap Check ---`);
		lines.push(overlapLines);
	}

	const text = lines.join("\n");
	return {
		content: [{ type: "text" as const, text }],
		details: { docName: response.docName, errorCount, errors, overlaps: overlapResult ?? null },
	};
}
