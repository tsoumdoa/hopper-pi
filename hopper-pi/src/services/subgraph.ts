import type { ParsedGrasshopper, SubGraph, Wire } from "../types/gh.js";

function extractComponentId(handle: string): string | null {
	const dotIndex = handle.indexOf(".");
	if (dotIndex === -1) return null;
	return handle.substring(0, dotIndex);
}

export function computeSubGraphs(parsed: ParsedGrasshopper): SubGraph[] {
	const componentIds = new Set(Object.keys(parsed.components));
	if (componentIds.size === 0) return [];

	const adjacency = new Map<string, Set<string>>();
	for (const id of componentIds) {
		adjacency.set(id, new Set());
	}

	const wireEndpoints: Array<{ wire: Wire; fromId: string | null; toId: string | null }> = [];

	for (const wire of parsed.wires) {
		const fromId = extractComponentId(wire.from);
		const toId = extractComponentId(wire.to);

		wireEndpoints.push({ wire, fromId, toId });

		if (fromId && toId && componentIds.has(fromId) && componentIds.has(toId)) {
			adjacency.get(fromId)!.add(toId);
			adjacency.get(toId)!.add(fromId);
		}
	}

	const visited = new Set<string>();
	const clusters: string[][] = [];

	for (const id of componentIds) {
		if (visited.has(id)) continue;
		visited.add(id);

		const cluster: string[] = [id];
		const queue = [id];

		while (queue.length > 0) {
			const current = queue.shift()!;
			for (const neighbor of adjacency.get(current)!) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					cluster.push(neighbor);
					queue.push(neighbor);
				}
			}
		}

		clusters.push(cluster);
	}

	clusters.sort((a, b) => b.length - a.length);

	const subGraphs: SubGraph[] = clusters.map((cluster, index) => {
		const clusterSet = new Set(cluster);

		const internalWires: Wire[] = [];
		const externalWires: Wire[] = [];

		for (const { wire, fromId, toId } of wireEndpoints) {
			const fromIn = fromId !== null && clusterSet.has(fromId);
			const toIn = toId !== null && clusterSet.has(toId);

			if (fromIn && toIn) {
				internalWires.push(wire);
			} else if (fromIn || toIn) {
				externalWires.push(wire);
			}
		}

		return {
			id: `subgraph_${index}`,
			components: cluster,
			internalWires,
			externalWires,
		};
	});

	return subGraphs;
}
