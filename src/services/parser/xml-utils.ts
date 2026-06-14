import type { XmlChunk } from "../../types/parser.js";

export function normalizeArray<T>(item: T | T[] | undefined): T[] {
	if (item === undefined) return [];
	return Array.isArray(item) ? item : [item];
}

export function extractItems(chunk: XmlChunk): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const items = normalizeArray(chunk.items?.item);

	for (const item of items) {
		const name = item.name;
		if (!name) continue;

		const typeName = item.type_name;
		const text = item["#text"];
		const index = item.index;

		if (text !== undefined) {
			const key = index !== undefined ? `${name}_${index}` : name;

			if (text === "true") {
				result[key] = true;
			} else if (text === "false") {
				result[key] = false;
			} else if (
				typeof text === "string" &&
				!isNaN(Number(text)) &&
				text !== ""
			) {
				result[key] = Number(text);
			} else {
				result[key] = text;
			}
		} else if (typeName === "gh_drawing_rectanglef") {
			result[name] = {
				x: Number(item.X),
				y: Number(item.Y),
				width: Number(item.W),
				height: Number(item.H),
			};
		} else if (
			typeName === "gh_drawing_pointf" ||
			typeName === "gh_drawing_point"
		) {
			result[name] = {
				x: Number(item.X),
				y: Number(item.Y),
			};
		} else if (typeName === "gh_drawing_color") {
			result[name] = item.ARGB;
		} else if (typeName === "gh_bytearray") {
			const stream = item.stream as
				| { length?: string; [key: string]: unknown }
				| undefined;
			if (stream && stream["#text"]) {
				result[name] = {
					data: String(stream["#text"]),
					size: Number(stream.length) || 0,
				};
			}
		}
	}

	return result;
}

export function extractIndexedItems(chunk: XmlChunk, itemName: string): string[] {
	const result: string[] = [];
	const items = normalizeArray(chunk.items?.item);

	for (const item of items) {
		if (item.name === itemName && item["#text"] !== undefined) {
			const index = item.index !== undefined ? Number(item.index) : 0;
			if (!isNaN(index)) {
				result[index] = String(item["#text"]);
			}
		}
	}

	return result.filter((x): x is string => x !== undefined);
}

export function findChunk(parent: XmlChunk, name: string): XmlChunk | undefined {
	const chunks = normalizeArray(parent.chunks?.chunk);
	return chunks.find((c) => c.name === name);
}

export function findAllChunks(parent: XmlChunk, name: string): XmlChunk[] {
	const chunks = normalizeArray(parent.chunks?.chunk);
	return chunks.filter((c) => c.name === name);
}
