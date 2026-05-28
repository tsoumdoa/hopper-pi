import { Requester } from "../infra/requester.js";
import { withRequester } from "../infra/request-helpers.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse, GetCanvasErrorsResponse, GhComponentInfo, ListScriptParamsResponse, GetScriptCodeResponse } from "../types/messages.js";
import type { Component, SubGraph, Wire } from "../types/gh.js";
import { buildGhJson } from "../services/parser.js";
import { computeSubGraphs } from "../services/subgraph.js";
import {
	toShortInstanceGuid,
	toShortTypeGuid,
} from "../services/guid-shortener.js";
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

let _components: ListAllComponentsResponse | null = null;

function shortenComponentGuids(component: Component): Component {
	const shortInputs: Component["inputs"] = {};
	for (const [key, input] of Object.entries(component.inputs)) {
		shortInputs[key] = {
			...input,
			instanceGuid: toShortInstanceGuid(input.instanceGuid),
		};
	}

	const shortOutputs: Component["outputs"] = {};
	for (const [key, output] of Object.entries(component.outputs)) {
		shortOutputs[key] = {
			...output,
			instanceGuid: toShortInstanceGuid(output.instanceGuid),
		};
	}

	return {
		...component,
		typeGuid: toShortTypeGuid(component.typeGuid),
		instanceGuid: toShortInstanceGuid(component.instanceGuid),
		inputs: shortInputs,
		outputs: shortOutputs,
	};
}

export async function getCachedOrFetchComponents(): Promise<ListAllComponentsResponse> {
	if (_components) return _components;
	const data = await withRequester(fetchAllComponents);
	_components = data;
	return data;
}

export async function fetchGh<T>(req: Requester, type: string): Promise<T> {
	return req.request<T>({ type });
}

export async function fetchCurrentCanvas(req: Requester): Promise<GetCurrentCanvasResponse> {
	return fetchGh<GetCurrentCanvasResponse>(req, "getCurrentCanvas");
}

export async function fetchAllComponents(req: Requester): Promise<ListAllComponentsResponse> {
	return fetchGh<ListAllComponentsResponse>(req, "listAllComponents");
}

export async function fetchCanvasErrors(req: Requester): Promise<GetCanvasErrorsResponse> {
	return fetchGh<GetCanvasErrorsResponse>(req, "getCanvasErrors");
}

export async function fetchScriptParams(req: Requester, targetId: string): Promise<ListScriptParamsResponse> {
	return req.request<ListScriptParamsResponse>({ type: "listScriptParams", targetId });
}

export async function fetchScriptCode(req: Requester, targetId: string): Promise<GetScriptCodeResponse> {
	return req.request<GetScriptCodeResponse>({ type: "getScriptCode", targetId });
}

export function formatScriptParamsResponse(response: ListScriptParamsResponse) {
	const lines: string[] = [];

	if (response.inputs.length > 0) {
		lines.push("INPUTS:");
		for (const p of response.inputs) {
			lines.push(`  ${p.name} [${p.access}, ${p.dataMapping}, simplify=${p.simplify}, reverse=${p.reverse}]`);
		}
	}

	if (response.outputs.length > 0) {
		lines.push("OUTPUTS:");
		for (const p of response.outputs) {
			lines.push(`  ${p.name} [${p.access}, ${p.dataMapping}, simplify=${p.simplify}, reverse=${p.reverse}]`);
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

function expandExcludedIds(
	components: Record<string, Component>,
	wires: Wire[],
	initialExcluded: Set<string>,
): Set<string> {
	const adjacency = new Map<string, Set<string>>();
	for (const wire of wires) {
		const fromId = wire.from.split(".")[0];
		const toId = wire.to.split(".")[0];
		if (!adjacency.has(fromId)) adjacency.set(fromId, new Set());
		if (!adjacency.has(toId)) adjacency.set(toId, new Set());
		adjacency.get(fromId)!.add(toId);
		adjacency.get(toId)!.add(fromId);
	}

	const excluded = new Set(initialExcluded);
	let changed = true;
	while (changed) {
		changed = false;
		for (const [id, neighbors] of adjacency) {
			if (excluded.has(id)) continue;
			const hasNonExcludedNeighbor = [...neighbors].some((n) => !excluded.has(n));
			if (!hasNonExcludedNeighbor) {
				excluded.add(id);
				changed = true;
			}
		}
	}
	return excluded;
}

type CanvasFilters = {
	subgraph?: string;
};

function matchesCanvasComponent(_c: Component, _filters: CanvasFilters): boolean {
	return true;
}

function formatComponentDetail(id: string, c: Component): string[] {
	const lines: string[] = [];
	lines.push(`[${id}] ${c.nickName} (${c.type})`);
	lines.push(`  COMPONENT_GUID=${c.instanceGuid}`);

	if (Object.keys(c.outputs).length > 0) {
		lines.push("  OUTPUTS:");
		for (const [_key, p] of Object.entries(c.outputs)) {
			const desc = p.description ? ` - ${p.description}` : "";
			lines.push(`    ${p.nick} (PORT_GUID=${p.instanceGuid})${desc}`);
		}
	}

	if (Object.keys(c.inputs).length > 0) {
		lines.push("  INPUTS:");
		for (const [_key, p] of Object.entries(c.inputs)) {
			const desc = p.description ? ` - ${p.description}` : "";
			lines.push(`    ${p.nick} (PORT_GUID=${p.instanceGuid})${desc}`);
		}
	}

	if (c.value) {
		const v = c.value;
		if (v.type === "slider") lines.push(`  slider: min=${v.min} max=${v.max} current=${v.current}`);
		else if (v.type === "panel") lines.push(`  panel: "${v.text}"`);
		else if (v.type === "number") lines.push(`  number: current=${v.current}`);
		else lines.push(`  value: ${v.type}`);
	}
	if (c.state?.locked) lines.push("  locked");
	if (c.state?.hidden) lines.push("  hidden");
	if (c.visuals?.pivot) {
		lines.push(`  pivot: (${c.visuals.pivot.x}, ${c.visuals.pivot.y})`);
	}
	if (c.visuals?.bounds) {
		lines.push(`  bounds: x=${c.visuals.bounds.x} y=${c.visuals.bounds.y} w=${c.visuals.bounds.width} h=${c.visuals.bounds.height}`);
	}
	lines.push("");
	return lines;
}

function formatCanvasIndex(
	docName: string,
	compCount: number,
	wireCount: number,
	subGraphCount: number,
	subGraphs: SubGraph[],
	components: Record<string, Component>,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
	const lines: string[] = [
		`Canvas: ${docName} (${compCount} components, ${wireCount} wires, ${subGraphCount} sub-graphs)`,
		"",
	];

	if (subGraphCount === 0) {
		const typeCounts = new Map<string, number>();
		for (const c of Object.values(components)) {
			typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
		}
		const typeSummary = Array.from(typeCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([type, count]) => `${type}(${count})`)
			.join(", ");

		if (typeSummary) {
			lines.push(`Component types: ${typeSummary}`);
		}
		lines.push("");
		lines.push("Use component or type params to inspect specific components.");
	} else {
		const realSubGraphs: SubGraph[] = [];
		const isolated: SubGraph[] = [];
		for (const sg of subGraphs) {
			if (sg.components.length === 1 && sg.internalWires.length === 0 && sg.externalWires.length === 0) {
				isolated.push(sg);
			} else {
				realSubGraphs.push(sg);
			}
		}

		if (realSubGraphs.length > 0) {
			lines.push("Sub-graph index:");
			for (const sg of realSubGraphs) {
				const typeCounts = new Map<string, number>();
				for (const compId of sg.components) {
					const c = components[compId];
					if (c) {
						typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
					}
				}
				const typeSummary = Array.from(typeCounts.entries())
					.sort((a, b) => b[1] - a[1])
					.map(([type, count]) => `${type}(${count})`)
					.join(", ");

				lines.push(`  ${sg.id}  — ${sg.components.length} components, ${sg.internalWires.length} internal wires, ${sg.externalWires.length} external`);
				if (typeSummary) {
					lines.push(`    types: ${typeSummary}`);
				}
			}
			lines.push("");
		}

		if (isolated.length > 0) {
			lines.push("Isolated:");
			for (const sg of isolated) {
				const compId = sg.components[0];
				const c = components[compId];
				if (c) {
					lines.push(...formatComponentDetail(compId, c));
				}
			}
		}

		if (realSubGraphs.length > 0) {
			lines.push("Use subgraph, component, or type params to inspect a specific sub-graph or component.");
		} else {
			lines.push("Use component or type params to inspect specific components.");
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			docName,
			componentCount: compCount,
			wireCount,
			subGraphCount,
			subGraphs,
		},
	};
}

function formatCanvasDetail(
	docName: string,
	compCount: number,
	wireCount: number,
	subGraphCount: number,
	subGraphs: SubGraph[],
	shortComponents: Record<string, Component>,
	filters: CanvasFilters,
	filteredWires: Wire[],
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
	const lines: string[] = [
		`Canvas: ${docName} (${compCount} components, ${wireCount} wires, ${subGraphCount} sub-graphs)`,
		"",
	];

	const filterDesc: string[] = [];
	if (filters.subgraph) filterDesc.push(`subgraph=${filters.subgraph}`);
	if (filterDesc.length > 0) {
		lines.push(`Filter: ${filterDesc.join(", ")}`);
		lines.push("");
	}

	if (subGraphs.length === 0) {
		for (const [compId, c] of Object.entries(shortComponents)) {
			lines.push(...formatComponentDetail(compId, c));
		}

		if (filteredWires.length > 0) {
			lines.push("--- wires ---");
			for (const w of filteredWires) {
				lines.push(`  ${w.from} -> ${w.to}`);
			}
		}
	} else {
		for (const sg of subGraphs) {
			if (filters.subgraph && sg.id !== filters.subgraph) {
				lines.push(`  ${sg.id} — (${sg.components.length} components, skipped)`);
				continue;
			}

			lines.push(`--- Sub-graph: ${sg.id} (${sg.components.length} components, ${sg.internalWires.length} internal wires, ${sg.externalWires.length} external) ---`);
			lines.push("");

			if (sg.internalWires.length > 0) {
				lines.push("--- internal wires ---");
				for (const w of sg.internalWires) {
					lines.push(`  ${w.from} -> ${w.to}`);
				}
			}
			if (sg.externalWires.length > 0) {
				if (sg.internalWires.length > 0) lines.push("");
				lines.push("--- external wires ---");
				for (const w of sg.externalWires) {
					lines.push(`  ${w.from} -> ${w.to}`);
				}
			}

			lines.push("");
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			docName,
			componentCount: compCount,
			wireCount,
			subGraphCount,
			components: shortComponents,
			wires: filteredWires,
			subGraphs,
		},
	};
}

export function formatCanvasResponse(response: GetCurrentCanvasResponse, filters?: CanvasFilters) {
	const parsed = buildGhJson(response.xml);

	const initiallyExcluded = new Set(
		Object.entries(parsed.components)
			.filter(([, c]) => EXCLUDED_TYPE_GUIDS.includes(c.typeGuid))
			.map(([id]) => id),
	);
	const excludedIds = expandExcludedIds(parsed.components, parsed.wires, initiallyExcluded);
	const filteredComponents = Object.fromEntries(
		Object.entries(parsed.components).filter(([id]) => !excludedIds.has(id)),
	);
	const filteredWires = parsed.wires.filter(
		(w) => {
			const fromId = w.from.split(".")[0];
			const toId = w.to.split(".")[0];
			return !excludedIds.has(fromId) && !excludedIds.has(toId);
		},
	);

	const filteredSubGraphs = computeSubGraphs({ version: "", components: filteredComponents, wires: filteredWires });

	const shortComponents = Object.fromEntries(
		Object.entries(filteredComponents).map(([id, component]) => [
			id,
			shortenComponentGuids(component),
		])
	);
	const compCount = Object.keys(filteredComponents).length;
	const wireCount = filteredWires.length;
	const subGraphCount = filteredSubGraphs.length;

	if (!filters) {
		if (subGraphCount === 0) {
			return formatCanvasDetail(
				response.docName,
				compCount,
				wireCount,
				subGraphCount,
				filteredSubGraphs,
				shortComponents,
				{},
				filteredWires,
			);
		}
		return formatCanvasIndex(
			response.docName,
			compCount,
			wireCount,
			subGraphCount,
			filteredSubGraphs,
			shortComponents,
		);
	}

	return formatCanvasDetail(
		response.docName,
		compCount,
		wireCount,
		subGraphCount,
		filteredSubGraphs,
		shortComponents,
		filters,
		filteredWires,
	);
}

function matchComponent(c: GhComponentInfo, f: string) {
	const lower = f.toLowerCase();
	return (
		c.name.toLowerCase().includes(lower) ||
		c.category.toLowerCase().includes(lower) ||
		c.subcategory.toLowerCase().includes(lower) ||
		c.description.toLowerCase().includes(lower)
	);
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

function paginate<T>(items: T[], limit?: number, offset?: number): { slice: T[]; hasMore: boolean; totalMatched: number } {
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

function sortedComponents(components: GhComponentInfo[]): GhComponentInfo[] {
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

function formatGroupedLines(components: GhComponentInfo[]): string {
	const groups = groupByCategory(components);
	const parts: string[] = [];
	for (const [category, subMap] of groups) {
		parts.push(`== ${category} ==`);
		for (const [subcategory, items] of subMap) {
			parts.push(`  === ${subcategory} ===`);
			for (const c of items) {
				const desc = c.description.length > 60 ? c.description.slice(0, 57) + "..." : c.description;
				parts.push(`    ${c.name} [${toShortTypeGuid(c.typeGuid)}]  --  ${desc}`);
			}
		}
	}
	return parts.join("\n");
}

function pickComponentSummary(c: GhComponentInfo) {
	return {
		typeGuid: toShortTypeGuid(c.typeGuid),
		name: c.name,
		category: c.category,
		subcategory: c.subcategory,
	};
}

function isBlacklisted(c: GhComponentInfo): boolean {
	return BLACKLISTED_SUBCATEGORIES.some(
		(e) => e.category === c.category && e.subcategory === c.subcategory,
	);
}

export function formatComponentsMultiQuery(response: ListAllComponentsResponse, queries?: string[], limit?: number, offset?: number, searchFrom: string = "vanilla") {
	const all = response.components
		.filter((c) => !EXCLUDED_TYPE_GUIDS.includes(c.typeGuid))
		.filter((c) => !isBlacklisted(c))
		.filter((c) => {
			if (searchFrom === "params") return c.category === "Params";
			if (searchFrom === "plugin") return !VANILLA_CATEGORIES.has(c.category);
			return VANILLA_CATEGORIES.has(c.category) && c.category !== "Params";
		});
	const sorted = sortedComponents(all);

	if (!queries || queries.length === 0) {
		const { slice, hasMore, totalMatched } = paginate(sorted, limit, offset);
		const body = formatGroupedLines(slice);
		const footer = hasMore ? `\n  ... ${totalMatched - (offset ?? 0) - slice.length} more (call with offset=${(offset ?? 0) + slice.length})` : "";
		return {
			content: [{ type: "text" as const, text: `All components (${totalMatched}, showing ${slice.length}):${footer}\n${body}` }],
			details: { results: [], totalAvailable: all.length, hasMore },
		};
	}

	const sections: string[] = [];
	const results: Array<{ queryKeyword: string; result: Array<Record<string, unknown>>; hasMore: boolean; totalMatched: number }> = [];

	for (const q of queries) {
		const matched = sorted.filter((c) => matchComponent(c, q));
		const { slice, hasMore, totalMatched } = paginate(matched, limit, offset);
		results.push({ queryKeyword: q, result: slice.map(pickComponentSummary), hasMore, totalMatched });

		if (matched.length === 0) {
			sections.push(`"${q}" — no matches`);
		} else {
			const body = formatGroupedLines(slice);
			const showRange = `showing ${(offset ?? 0) + 1}-${(offset ?? 0) + slice.length}`;
			const footer = hasMore ? `\n  ... ${totalMatched - (offset ?? 0) - slice.length} more (call with offset=${(offset ?? 0) + slice.length})` : "";
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
