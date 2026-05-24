import { Requester } from "../infra/requester.js";
import { withRequester } from "../infra/request-helpers.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse, GetCanvasErrorsResponse, GhComponentInfo, ListScriptParamsResponse, GetScriptCodeResponse } from "../types/messages.js";
import type { Component, SubGraph, Wire } from "../types/gh.js";
import { buildGhJson } from "../services/parser.js";
import {
	toShortInstanceGuid,
	toShortTypeGuid,
} from "../services/guid-shortener.js";
import { formatOverlapResult } from "./canvas-checks.js";
import type { CanvasOverlapResult } from "./canvas-checks.js";
import { EXCLUDED_TYPE_GUIDS } from "./constants.js";

const CACHE_TTL_MS = 60_000;

let _cache: { data: ListAllComponentsResponse; fetchedAt: number } | null = null;

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
	if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
		return _cache.data;
	}
	const data = await withRequester(fetchAllComponents);
	_cache = { data, fetchedAt: Date.now() };
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

function filterSubGraphs(subGraphs: SubGraph[], excludedIds: Set<string>): SubGraph[] {
	const result: SubGraph[] = [];
	for (const sg of subGraphs) {
		const filteredComponents = sg.components.filter(id => !excludedIds.has(id));
		if (filteredComponents.length === 0) continue;
		const componentSet = new Set(filteredComponents);
		const internalWires = sg.internalWires.filter(w => {
			const fromId = w.from.split(".")[0];
			const toId = w.to.split(".")[0];
			return componentSet.has(fromId) && componentSet.has(toId);
		});
		const externalWires = sg.externalWires.filter(w => {
			const fromId = w.from.split(".")[0];
			const toId = w.to.split(".")[0];
			return componentSet.has(fromId) || componentSet.has(toId);
		});
		result.push({
			id: sg.id,
			components: filteredComponents,
			internalWires,
			externalWires,
		});
	}
	return result;
}

type CanvasFilters = {
	subgraph?: string;
	component?: string;
	type?: string;
};

function matchesCanvasComponent(c: Component, filters: CanvasFilters): boolean {
	if (filters.component) {
		const q = filters.component.toLowerCase();
		if (!c.id.toLowerCase().includes(q) && !c.nickName.toLowerCase().includes(q)) return false;
	}
	if (filters.type) {
		const q = filters.type.toLowerCase();
		if (!c.type.toLowerCase().includes(q)) return false;
	}
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
		"Sub-graph index:",
	];

	for (const sg of subGraphs) {
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
	lines.push("Use subgraph, component, or type params to inspect a specific sub-graph or component.");

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
	if (filters.component) filterDesc.push(`component=${filters.component}`);
	if (filters.type) filterDesc.push(`type=${filters.type}`);
	lines.push(`Filter: ${filterDesc.join(", ")}`);
	lines.push("");

	for (const sg of subGraphs) {
		if (filters.subgraph && sg.id !== filters.subgraph) {
			lines.push(`  ${sg.id} — (${sg.components.length} components, skipped)`);
			continue;
		}

		const matchedCompIds: string[] = [];
		for (const compId of sg.components) {
			const c = shortComponents[compId];
			if (!c) continue;
			if (matchesCanvasComponent(c, filters)) {
				matchedCompIds.push(compId);
			}
		}

		const hasComponentFilter = !!(filters.component || filters.type);

		lines.push(`--- Sub-graph: ${sg.id} (${sg.components.length} components, ${sg.internalWires.length} internal wires, ${sg.externalWires.length} external) ---`);
		lines.push("");

		if (hasComponentFilter && matchedCompIds.length === 0) {
			lines.push("  (no matching components)");
			lines.push("");
			continue;
		}

		const matchedSet = new Set(matchedCompIds);

		for (const compId of matchedCompIds) {
			const c = shortComponents[compId];
			if (!c) continue;
			lines.push(...formatComponentDetail(compId, c));
		}

		if (hasComponentFilter) {
			const relevantInternalWires = sg.internalWires.filter(w => {
				const fromId = w.from.split(".")[0];
				const toId = w.to.split(".")[0];
				return matchedSet.has(fromId) || matchedSet.has(toId);
			});
			const relevantExternalWires = sg.externalWires.filter(w => {
				const fromId = w.from.split(".")[0];
				const toId = w.to.split(".")[0];
				return matchedSet.has(fromId) || matchedSet.has(toId);
			});

			if (relevantInternalWires.length > 0) {
				lines.push("--- internal wires (matching) ---");
				for (const w of relevantInternalWires) {
					lines.push(`  ${w.from} -> ${w.to}`);
				}
			}
			if (relevantExternalWires.length > 0) {
				if (relevantInternalWires.length > 0) lines.push("");
				lines.push("--- external wires (matching) ---");
				for (const w of relevantExternalWires) {
					lines.push(`  ${w.from} -> ${w.to}`);
				}
			}
		} else {
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
		}

		lines.push("");
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

	const excludedIds = new Set(
		Object.entries(parsed.components)
			.filter(([, c]) => EXCLUDED_TYPE_GUIDS.includes(c.typeGuid))
			.map(([id]) => id),
	);
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

	const filteredSubGraphs = filterSubGraphs(parsed.subGraphs ?? [], excludedIds);

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

function pickSummary(c: GhComponentInfo) {
	return {
		name: c.name,
		typeGuid: toShortTypeGuid(c.typeGuid),
		category: c.category,
		subcategory: c.subcategory,
	};
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function formatComponentLine(c: GhComponentInfo) {
	const shortTypeGuid = toShortTypeGuid(c.typeGuid);
	return `  ${c.name}  [${shortTypeGuid}]  (${c.category}/${c.subcategory}) -- ${c.description}`;
}

function paginate<T>(items: T[], limit?: number, offset?: number): { slice: T[]; hasMore: boolean; totalMatched: number } {
	const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const effectiveOffset = Math.max(offset ?? 0, 0);
	const slice = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
	return { slice, hasMore: effectiveOffset + slice.length < items.length, totalMatched: items.length };
}

export function formatComponentsMultiQuery(response: ListAllComponentsResponse, queries?: string[], limit?: number, offset?: number) {
	const all = response.components.filter((c) => !EXCLUDED_TYPE_GUIDS.includes(c.typeGuid));

	if (!queries || queries.length === 0) {
		const { slice, hasMore, totalMatched } = paginate(all, limit, offset);
		const lines = slice.map(formatComponentLine);
		const footer = hasMore ? `\n  ... ${totalMatched - (offset ?? 0) - lines.length} more (call with offset=${(offset ?? 0) + lines.length})` : "";
		return {
			content: [{ type: "text" as const, text: `All components (${totalMatched}, showing ${lines.length}):${footer}\n${lines.join("\n")}` }],
			details: { results: [], totalAvailable: all.length, hasMore },
		};
	}

	const sections: string[] = [];
	const results: Array<{ queryKeyword: string; result: Array<Record<string, string>>; hasMore: boolean; totalMatched: number }> = [];

	for (const q of queries) {
		const matched = all.filter((c) => matchComponent(c, q));
		const { slice, hasMore, totalMatched } = paginate(matched, limit, offset);
		results.push({ queryKeyword: q, result: slice.map((c) => pickSummary(c)), hasMore, totalMatched });

		if (matched.length === 0) {
			sections.push(`"${q}" — no matches`);
		} else {
			const lines = slice.map(formatComponentLine);
			const showRange = `showing ${(offset ?? 0) + 1}-${(offset ?? 0) + lines.length}`;
			const footer = hasMore ? `\n  ... ${totalMatched - (offset ?? 0) - lines.length} more (call with offset=${(offset ?? 0) + lines.length})` : "";
			sections.push(`"${q}" (${totalMatched} matches, ${showRange}):${footer}\n${lines.join("\n")}`);
		}
	}

	return {
		content: [{ type: "text" as const, text: `Components search (${queries.length} queries, ${all.length} available):\n\n${sections.join("\n\n")}` }],
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
