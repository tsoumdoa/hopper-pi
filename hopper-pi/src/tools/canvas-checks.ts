import type { Component } from "../types/gh.js";
import { buildGhJson } from "../services/parser.js";

export type Bounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type OverlapInfo = {
	componentA: string;
	nickNameA: string;
	componentB: string;
	nickNameB: string;
	intersectionArea: number;
};

export type CanvasOverlapResult = {
	hasOverlaps: boolean;
	componentOverlaps: OverlapInfo[];
	groupOverlaps: OverlapInfo[];
};

function getBounds(c: Component): Bounds | null {
	return c.visuals?.bounds ?? null;
}

function rectsIntersect(a: Bounds, b: Bounds): boolean {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

function intersectionArea(a: Bounds, b: Bounds): number {
	const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	return xOverlap * yOverlap;
}

function isNestedInGroup(groupId: string, otherGroupId: string, components: Record<string, Component>): boolean {
	const group = components[otherGroupId];
	if (!group?.members) return false;
	if (group.members.includes(groupId)) return true;
	for (const memberId of group.members) {
		const member = components[memberId];
		if (member?.type === "Group" && isNestedInGroup(groupId, memberId, components)) return true;
	}
	return false;
}

function findOverlaps(
	items: Array<{ id: string; nickName: string; bounds: Bounds }>,
	skipPair?: (aId: string, bId: string) => boolean,
): OverlapInfo[] {
	const overlaps: OverlapInfo[] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			if (skipPair?.(a.id, b.id)) continue;
			if (rectsIntersect(a.bounds, b.bounds)) {
				overlaps.push({
					componentA: a.id,
					nickNameA: a.nickName,
					componentB: b.id,
					nickNameB: b.nickName,
					intersectionArea: intersectionArea(a.bounds, b.bounds),
				});
			}
		}
	}
	return overlaps;
}

export function checkCanvasOverlaps(xml: string): CanvasOverlapResult {
	const parsed = buildGhJson(xml);
	const components = parsed.components;

	const regularComponents: Array<{ id: string; nickName: string; bounds: Bounds }> = [];
	const groups: Array<{ id: string; nickName: string; bounds: Bounds }> = [];

	for (const [id, c] of Object.entries(components)) {
		const bounds = getBounds(c);
		if (!bounds) continue;
		if (c.type === "Group") {
			groups.push({ id, nickName: c.nickName, bounds });
		} else {
			regularComponents.push({ id, nickName: c.nickName, bounds });
		}
	}

	const componentOverlaps = findOverlaps(regularComponents);

	const groupOverlaps = findOverlaps(groups, (aId, bId) => {
		return isNestedInGroup(aId, bId, components) || isNestedInGroup(bId, aId, components);
	});

	return {
		hasOverlaps: componentOverlaps.length > 0 || groupOverlaps.length > 0,
		componentOverlaps,
		groupOverlaps,
	};
}

export function formatOverlapResult(result: CanvasOverlapResult): string {
	const lines: string[] = [];

	if (!result.hasOverlaps) {
		lines.push("No component or group overlaps detected.");
		return lines.join("\n");
	}

	if (result.componentOverlaps.length > 0) {
		lines.push(`${result.componentOverlaps.length} component overlap(s) detected:`);
		for (const o of result.componentOverlaps) {
			lines.push(`  ⚠️ ${o.nickNameA} (${o.componentA}) overlaps ${o.nickNameB} (${o.componentB}) — area=${o.intersectionArea}`);
		}
	}

	if (result.groupOverlaps.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(`${result.groupOverlaps.length} group overlap(s) detected:`);
		for (const o of result.groupOverlaps) {
			lines.push(`  ⚠️ Group "${o.nickNameA}" (${o.componentA}) overlaps Group "${o.nickNameB}" (${o.componentB}) — area=${o.intersectionArea}`);
		}
	}

	return lines.join("\n");
}
