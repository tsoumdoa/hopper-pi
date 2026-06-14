import type { ParsedGrasshopper, Component, Wire } from "../../types/gh.js";
import type { ParsedXml, ParsedComponent } from "../../types/parser.js";
import {
	normalizeArray,
	extractItems,
	extractIndexedItems,
	findChunk,
	findAllChunks,
} from "./xml-utils.js";
import { parseComponent } from "./component-parser.js";

export function parseGrasshopper(
	xmlData: ParsedXml
): ParsedGrasshopper {
	const archive = xmlData.Archive;
	if (!archive) {
		throw new Error("Invalid XML: Missing Archive root");
	}

	const items = normalizeArray(archive.items?.item);
	const versionItem = items.find((i) => i.name === "ArchiveVersion");
	const version = versionItem
		? `${versionItem.Major}.${versionItem.Minor}.${versionItem.Revision}`
		: "0.0.0";

	const chunks = normalizeArray(archive.chunks?.chunk);

	const defChunk = chunks.find((c) => c.name === "Definition");
	const definitionChunks = defChunk
		? normalizeArray(defChunk.chunks?.chunk)
		: chunks;

	const clipboardChunk = definitionChunks.find(
		(c) => c.name === "Clipboard" || c.name === "Archive"
	);

	const workingChunks = clipboardChunk
		? normalizeArray(clipboardChunk.chunks?.chunk)
		: definitionChunks;

	const definitionObjectsChunk = workingChunks.find(
		(c) => c.name === "DefinitionObjects"
	);

	if (!definitionObjectsChunk) {
		return {
			version,
			components: {},
			wires: [],
		};
	}

	const objectChunks = findAllChunks(definitionObjectsChunk, "Object");

	const ghaLibsChunk = definitionChunks.find((c) => c.name === "GHALibraries");
	const libraryMap = new Map<string, string>();
	if (ghaLibsChunk) {
		const libChunks = findAllChunks(ghaLibsChunk, "Library");
		for (const lib of libChunks) {
			const libItems = extractItems(lib);
			const libId = libItems.Id as string;
			const libName = libItems.Name as string;
			const libVersion = libItems.Version as string;
			if (libId && libName) {
				const fullName = libVersion ? `${libName} v${libVersion}` : libName;
				libraryMap.set(libId, fullName);
			}
		}
	}

	const components: Record<string, Component> = {};
	const guidToId: Map<string, string> = new Map();
	const outputPortGuidToHandle: Map<string, string> = new Map();
	const nickNameCounts: Map<string, number> = new Map();

	const parsedComponents: Array<{ parsed: ParsedComponent; id: string }> = [];

	for (const objectChunk of objectChunks) {
		const parsed = parseComponent(objectChunk, libraryMap);
		if (!parsed) continue;

		const baseNick = parsed.component.nickName || parsed.component.type;
		const count = (nickNameCounts.get(baseNick) || 0) + 1;
		nickNameCounts.set(baseNick, count);

		const uniqueId = count === 1 ? baseNick : `${baseNick}_${count}`;
		parsed.component.id = uniqueId;

		components[uniqueId] = parsed.component;
		guidToId.set(parsed.instanceGuid, uniqueId);

		const containerChunk = findChunk(objectChunk, "Container");
		if (containerChunk) {
			const containerItems = extractItems(containerChunk);
			const containerInstanceGuid = containerItems.InstanceGuid as string;
			if (containerInstanceGuid && containerInstanceGuid !== parsed.instanceGuid) {
				guidToId.set(containerInstanceGuid, uniqueId);
			}
		}

		for (const [portKey, outputPort] of Object.entries(parsed.component.outputs)) {
			if (outputPort.instanceGuid) {
				outputPortGuidToHandle.set(outputPort.instanceGuid, `${uniqueId}.${portKey}`);
			}
		}

		parsedComponents.push({ parsed, id: uniqueId });
	}

	const wires: Wire[] = [];

	for (const { id: compId, parsed } of parsedComponents) {
		const component = parsed.component;
		for (const [inputName, input] of Object.entries(component.inputs)) {
			const allSources = input.sources ?? (input.source ? [input.source] : []);

			for (const src of allSources) {
				const resolvedFrom =
					outputPortGuidToHandle.get(src) ??
					guidToId.get(src);

				if (resolvedFrom) {
					wires.push({
						from: resolvedFrom,
						to: `${compId}.${inputName}`,
						sourceComponentGuid: src,
						targetPortGuid: input.instanceGuid,
					});
				} else {
					wires.push({
						from: src,
						to: `${compId}.${inputName}`,
						sourceComponentGuid: src,
						targetPortGuid: input.instanceGuid,
					});
				}
			}

			if (input.source) {
				const resolvedFrom =
					outputPortGuidToHandle.get(input.source) ??
					guidToId.get(input.source);
				if (resolvedFrom) input.source = resolvedFrom;
			}
		}
	}

	for (const { id: _compId, parsed } of parsedComponents) {
		const component = parsed.component;
		if (component.type === "Group") {
			const containerChunk = findChunk(parsed.objectChunk, "Container");
			if (containerChunk) {
				const memberGuids = extractIndexedItems(containerChunk, "ID");
				component.members = memberGuids
					.map((guid) => guidToId.get(guid))
					.filter((id): id is string => id !== undefined);
			}
		}
	}

	const metadata: ParsedGrasshopper["metadata"] = {};

	const pluginVersionItem = definitionChunks
		.flatMap((c) => normalizeArray(c.items?.item))
		.find((i) => i.name === "plugin_version");

	if (pluginVersionItem) {
		metadata.pluginVersion = `${pluginVersionItem.Major}.${pluginVersionItem.Minor}.${pluginVersionItem.Revision}`;
	}

	const documentHeaderChunk = definitionChunks.find(
		(c) => c.name === "DocumentHeader"
	);
	if (documentHeaderChunk) {
		const docItems = extractItems(documentHeaderChunk);
		metadata.documentId = docItems.DocumentID as string;
	}

	if (ghaLibsChunk) {
		const libChunks = findAllChunks(ghaLibsChunk, "Library");
		metadata.libraries = libChunks.map((lib) => {
			const libItems = extractItems(lib);
			return {
				name: libItems.Name as string,
				version: (libItems.Version as string) || "",
				author: libItems.Author as string,
			};
		});
	}

	const seen = new Set<string>();
	metadata.libraries = metadata.libraries?.filter((l) => {
		const key = `${l.name}__${l.version}__${l.author}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	return {
		version,
		components,
		wires,
		metadata,
	};
}
