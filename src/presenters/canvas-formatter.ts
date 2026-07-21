import { buildGhJson } from "../services/parser.js";
import { computeSubGraphs } from "../services/subgraph.js";
import {
	toShortInstanceGuid,
	toShortTypeGuid,
} from "../services/guid-shortener.js";
import { truncateDescription } from "../services/component-search.js";
import type { GetCurrentCanvasResponse } from "../types/messages.js";
import type { Component, SubGraph, Wire } from "../types/gh.js";
import {
	applyCanvasExclusions,
	applySelectionFilter,
	filterCanvasByComponentIds,
	type CanvasFilters,
} from "../services/canvas-filter.js";

export type { CanvasFilters };

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

function formatEmptySelectionResponse(docName: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: "No objects selected on the Grasshopper canvas. Select components in Grasshopper and call gh_get_canvas with selectionOnly: true.",
			},
		],
		details: {
			docName,
			componentCount: 0,
			wireCount: 0,
			subGraphCount: 0,
			components: {},
			wires: [],
			subGraphs: [],
			selectionOnly: true,
		},
	};
}

function formatComponentDetail(id: string, c: Component): string[] {
	const lines: string[] = [];
	lines.push(`[${id}] ${c.nickName} (${c.type})`);
	lines.push(`  COMPONENT_GUID=${c.instanceGuid}`);

	if (Object.keys(c.outputs).length > 0) {
		lines.push("  OUTPUTS:");
		for (const [_key, p] of Object.entries(c.outputs)) {
			const desc = p.description ? ` - ${truncateDescription(p.description)}` : "";
			lines.push(`    ${p.nick} (PORT_GUID=${p.instanceGuid})${desc}`);
		}
	}

	if (Object.keys(c.inputs).length > 0) {
		lines.push("  INPUTS:");
		for (const [_key, p] of Object.entries(c.inputs)) {
			const desc = p.description ? ` - ${truncateDescription(p.description)}` : "";
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
	if (filters.selectionOnly) filterDesc.push("selectionOnly=true");
	if (filters.subgraph) filterDesc.push(`subgraph=${filters.subgraph}`);
	if (filters.componentIds?.length) filterDesc.push(`componentIds=${filters.componentIds.length}`);
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

			for (const compId of sg.components) {
				const c = shortComponents[compId];
				if (c) lines.push(...formatComponentDetail(compId, c));
			}

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

function formatDocHeader(response: GetCurrentCanvasResponse): string {
	const extras: string[] = [];
	if (response.units) extras.push(`units=${response.units}`);
	if (response.absoluteTolerance != null) extras.push(`tol=${response.absoluteTolerance}`);
	return extras.length > 0 ? `${response.docName} · ${extras.join(", ")}` : response.docName;
}

export function formatCanvasResponse(response: GetCurrentCanvasResponse, filters?: CanvasFilters) {
	const parsed = buildGhJson(response.xml);

	let { components: filteredComponents, wires: filteredWires } = applyCanvasExclusions(parsed);

	if (filters?.componentIds?.length) {
		const filtered = filterCanvasByComponentIds(
			{ components: filteredComponents, wires: filteredWires },
			filters.componentIds,
		);
		filteredComponents = filtered.components;
		filteredWires = filtered.wires;

		if (Object.keys(filteredComponents).length === 0) {
			return {
				content: [
					{
						type: "text" as const,
						text: "No components matched the given componentIds. Check the IDs or call gh_get_canvas without filters.",
					},
				],
				details: { docName: response.docName, componentCount: 0, wireCount: 0, subGraphCount: 0, components: {}, wires: [], subGraphs: [] },
			};
		}
	}

	if (filters?.selectionOnly) {
		const selected = applySelectionFilter(filteredComponents, filteredWires, response);
		filteredComponents = selected.components;
		filteredWires = selected.wires;

		if (Object.keys(filteredComponents).length === 0) {
			return formatEmptySelectionResponse(response.docName);
		}
	}

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

	const docLabel = formatDocHeader(response);

	if (!filters) {
		if (subGraphCount === 0) {
			return formatCanvasDetail(
				docLabel,
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
			docLabel,
			compCount,
			wireCount,
			subGraphCount,
			filteredSubGraphs,
			shortComponents,
		);
	}

	return formatCanvasDetail(
		docLabel,
		compCount,
		wireCount,
		subGraphCount,
		filteredSubGraphs,
		shortComponents,
		filters,
		filteredWires,
	);
}
