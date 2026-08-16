import { createHash } from "node:crypto";
import { EXCLUDED_TYPE_GUIDS } from "../tools/constants.js";
import { buildGhJson } from "../services/parser/index.js";
import { canonicalJsonSha256 } from "../protocol/wire.js";
import type {
	CanonicalCanvas,
	CanonicalCanvasObject,
	CanonicalGroup,
	CanonicalWire,
	CanvasDiff,
	JsonObject,
	JsonValue,
} from "./contracts.js";

const HOPPER_TYPE_IDS = new Set(EXCLUDED_TYPE_GUIDS.map((id) => id.toLowerCase()));

function isJsonObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function roundCoord(value: number): number {
	return Number.parseFloat(value.toFixed(4));
}

function wireKey(wire: CanonicalWire): string {
	return `${wire.fromObjectId}\0${wire.fromPort}\0${wire.toObjectId}\0${wire.toPort}`;
}

function sortCanvas(canvas: CanonicalCanvas): CanonicalCanvas {
	return {
		objects: [...canvas.objects].sort((left, right) => left.id.localeCompare(right.id)),
		wires: [...canvas.wires].sort((left, right) => wireKey(left).localeCompare(wireKey(right))),
		groups: [...canvas.groups]
			.map((group) => ({
				...group,
				memberIds: [...group.memberIds].sort((left, right) => left.localeCompare(right)),
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
	};
}

function splitHandle(handle: string): { objectId: string; port: string } {
	const separator = handle.lastIndexOf(".");
	if (separator <= 0) return { objectId: handle, port: "" };
	return { objectId: handle.slice(0, separator), port: handle.slice(separator + 1) };
}

function componentProperties(component: {
	script?: { code?: string; language?: string };
	value?: JsonValue;
	expression?: string;
	internalExpression?: string;
	state?: { hidden?: boolean; locked?: boolean; frozen?: boolean };
}): JsonObject {
	const properties: JsonObject = {};
	if (component.script?.code) properties.script = component.script.code;
	if (component.script?.language) properties.language = component.script.language;
	if (component.expression) properties.expression = component.expression;
	if (component.internalExpression) properties.internalExpression = component.internalExpression;
	if (component.value && isJsonObject(component.value)) properties.value = component.value;
	if (component.state?.hidden) properties.hidden = true;
	if (component.state?.locked) properties.locked = true;
	if (component.state?.frozen) properties.frozen = true;
	return properties;
}

export function canonicalizeCanvas(xml: string): CanonicalCanvas {
	const parsed = buildGhJson(xml);
	const objects: CanonicalCanvasObject[] = [];
	const groups: CanonicalGroup[] = [];

	for (const component of Object.values(parsed.components)) {
		const typeId = (component.typeGuid ?? "").toLowerCase();
		if (HOPPER_TYPE_IDS.has(typeId)) continue;
		const id = component.instanceGuid || component.id;
		if (component.type === "Group") {
			groups.push({
				id,
				name: component.nickName || component.id,
				memberIds: [...(component.members ?? [])],
				properties: {},
			});
			continue;
		}
		objects.push({
			id,
			typeId: component.typeGuid || component.type,
			kind: component.type,
			name: component.nickName || component.id,
			x: roundCoord(component.visuals?.pivot?.x ?? component.visuals?.bounds?.x ?? 0),
			y: roundCoord(component.visuals?.pivot?.y ?? component.visuals?.bounds?.y ?? 0),
			properties: componentProperties(component),
		});
	}

	const wires: CanonicalWire[] = parsed.wires.map((wire) => {
		const from = splitHandle(wire.from);
		const to = splitHandle(wire.to);
		return {
			fromObjectId: from.objectId,
			fromPort: from.port,
			toObjectId: to.objectId,
			toPort: to.port,
		};
	});

	return sortCanvas({ objects, wires, groups });
}

export function digestCanvas(canvas: CanonicalCanvas): string {
	return canonicalJsonSha256(sortCanvas(canvas) as unknown as JsonValue);
}

export function digestBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function emptyCanvas(): CanonicalCanvas {
	return { objects: [], wires: [], groups: [] };
}

export function emptyDiff(beforeDigest: string, afterDigest: string): CanvasDiff {
	return {
		beforeDigest,
		afterDigest,
		added: [],
		removed: [],
		moved: [],
		renamed: [],
		propertiesChanged: [],
		wiresAdded: [],
		wiresRemoved: [],
		groupsChanged: [],
	};
}

function sameProperties(left: JsonObject, right: JsonObject): boolean {
	return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

export function diffCanvases(before: CanonicalCanvas, after: CanonicalCanvas): CanvasDiff {
	const normalizedBefore = sortCanvas(before);
	const normalizedAfter = sortCanvas(after);
	const beforeObjects = new Map(normalizedBefore.objects.map((object) => [object.id, object]));
	const afterObjects = new Map(normalizedAfter.objects.map((object) => [object.id, object]));
	const added: CanvasDiff["added"] = [];
	const removed: CanvasDiff["removed"] = [];
	const moved: CanvasDiff["moved"] = [];
	const renamed: CanvasDiff["renamed"] = [];
	const propertiesChanged: CanvasDiff["propertiesChanged"] = [];

	for (const [id, object] of afterObjects) {
		const previous = beforeObjects.get(id);
		if (!previous) {
			added.push({ id, object });
			continue;
		}
		if (previous.x !== object.x || previous.y !== object.y) {
			moved.push({
				id,
				before: { x: previous.x, y: previous.y },
				after: { x: object.x, y: object.y },
			});
		}
		if (previous.name !== object.name) {
			renamed.push({ id, before: previous.name, after: object.name });
		}
		if (!sameProperties(previous.properties, object.properties)) {
			propertiesChanged.push({ id, before: previous.properties, after: object.properties });
		}
	}
	for (const [id, object] of beforeObjects) {
		if (!afterObjects.has(id)) removed.push({ id, object });
	}

	const beforeWires = new Map(normalizedBefore.wires.map((wire) => [wireKey(wire), wire]));
	const afterWires = new Map(normalizedAfter.wires.map((wire) => [wireKey(wire), wire]));
	const wiresAdded = [...afterWires.entries()]
		.filter(([key]) => !beforeWires.has(key))
		.map(([, wire]) => wire);
	const wiresRemoved = [...beforeWires.entries()]
		.filter(([key]) => !afterWires.has(key))
		.map(([, wire]) => wire);

	const beforeGroups = new Map(normalizedBefore.groups.map((group) => [group.id, group]));
	const afterGroups = new Map(normalizedAfter.groups.map((group) => [group.id, group]));
	const groupsChanged: CanvasDiff["groupsChanged"] = [];
	for (const [id, group] of afterGroups) {
		const previous = beforeGroups.get(id);
		if (!previous) {
			groupsChanged.push({ id, before: null, after: group });
			continue;
		}
		if (
			previous.name !== group.name
			|| previous.memberIds.join("\0") !== group.memberIds.join("\0")
			|| !sameProperties(previous.properties, group.properties)
		) {
			groupsChanged.push({ id, before: previous, after: group });
		}
	}
	for (const [id, group] of beforeGroups) {
		if (!afterGroups.has(id)) groupsChanged.push({ id, before: group, after: null });
	}

	return {
		beforeDigest: digestCanvas(normalizedBefore),
		afterDigest: digestCanvas(normalizedAfter),
		added,
		removed,
		moved,
		renamed,
		propertiesChanged,
		wiresAdded,
		wiresRemoved,
		groupsChanged,
	};
}
