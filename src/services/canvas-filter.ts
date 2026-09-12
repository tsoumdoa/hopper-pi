import type { GetCurrentCanvasResponse } from "../types/messages.js";
import type { Component, ParsedGrasshopper, Wire } from "../types/gh.js";
import { EXCLUDED_TYPE_GUIDS } from "../tools/constants.js";

export type CanvasFilters = {
	subgraph?: string;
	selectionOnly?: boolean;
};

export function expandExcludedIds(
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
	// A newly excluded node has no remaining neighbors, so it cannot cause
	// another exclusion. One pass over this undirected graph is sufficient.
	for (const [id, neighbors] of adjacency) {
		if ([...neighbors].every((neighbor) => initialExcluded.has(neighbor))) {
			excluded.add(id);
		}
	}
	return excluded;
}

function normalizeGuidSet(guids: Iterable<string>): Set<string> {
	return new Set(
		[...guids].map((g) => g.toLowerCase()),
	);
}

function expandSelectedIdsForGroups(
	components: Record<string, Component>,
	selectedIds: Set<string>,
): Set<string> {
	const expanded = new Set(selectedIds);
	// Set iteration also visits added members, including nested groups.
	for (const id of expanded) {
		const component = components[id];
		if (component?.type !== "Group") continue;
		for (const memberId of component.members ?? []) expanded.add(memberId);
	}
	return expanded;
}

function resolveSelectionGuids(
	components: Record<string, Component>,
	response: GetCurrentCanvasResponse,
): Set<string> {
	if (response.selectedInstanceGuids?.length) {
		return normalizeGuidSet(response.selectedInstanceGuids);
	}
	const fromState = Object.values(components)
		.filter((c) => c.state?.selected === true)
		.map((c) => c.instanceGuid);
	return normalizeGuidSet(fromState);
}

export function filterCanvasBySelection(
	parsed: Pick<ParsedGrasshopper, "components" | "wires">,
	selectedInstanceGuids: Set<string>,
): Pick<ParsedGrasshopper, "components" | "wires"> {
	const selectedIds = new Set<string>();
	for (const [id, component] of Object.entries(parsed.components)) {
		if (selectedInstanceGuids.has(component.instanceGuid.toLowerCase())) {
			selectedIds.add(id);
		}
	}

	const expandedIds = expandSelectedIdsForGroups(parsed.components, selectedIds);

	const components = Object.fromEntries(
		Object.entries(parsed.components).filter(([id]) => expandedIds.has(id)),
	);

	const wires = parsed.wires.filter((w) => {
		const fromId = w.from.split(".")[0];
		const toId = w.to.split(".")[0];
		return expandedIds.has(fromId) && expandedIds.has(toId);
	});

	return { components, wires };
}

export function applyCanvasExclusions(parsed: ParsedGrasshopper): {
	components: Record<string, Component>;
	wires: Wire[];
} {
	const initiallyExcluded = new Set(
		Object.entries(parsed.components)
			.filter(([, c]) => EXCLUDED_TYPE_GUIDS.includes(c.typeGuid))
			.map(([id]) => id),
	);
	const excludedIds = expandExcludedIds(parsed.wires, initiallyExcluded);
	const components = Object.fromEntries(
		Object.entries(parsed.components).filter(([id]) => !excludedIds.has(id)),
	);
	const wires = parsed.wires.filter((w) => {
		const fromId = w.from.split(".")[0];
		const toId = w.to.split(".")[0];
		return !excludedIds.has(fromId) && !excludedIds.has(toId);
	});
	return { components, wires };
}

export function applySelectionFilter(
	components: Record<string, Component>,
	wires: Wire[],
	response: GetCurrentCanvasResponse,
): Pick<ParsedGrasshopper, "components" | "wires"> {
	const selectionGuids = resolveSelectionGuids(components, response);
	return filterCanvasBySelection({ components, wires }, selectionGuids);
}
