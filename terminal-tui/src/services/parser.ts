import { XMLParser } from "fast-xml-parser";
import type {
	ParsedGrasshopper,
	Component,
	InputPort,
	OutputPort,
	Wire,
	ParseOptions,
	Visuals,
	ComponentState,
	DataMapping,
	PortOptions,
} from "../types/gh.js";
import type { ParsedXml, XmlChunk, ParsedComponent } from "../types/parser.js";

function normalizeArray<T>(item: T | T[] | undefined): T[] {
	if (item === undefined) return [];
	return Array.isArray(item) ? item : [item];
}

function extractItems(chunk: XmlChunk): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const items = normalizeArray(chunk.items?.item);

	for (const item of items) {
		const name = item.name;
		if (!name) continue;

		const typeName = item.type_name;
		const text = item["#text"];
		const index = item.index;

		if (text !== undefined) {
			// Handle indexed items (e.g., ID_0, ID_1 for groups)
			const key = index !== undefined ? `${name}_${index}` : name;

			// Try to parse as number or boolean
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
			// Handle binary data streams (e.g., cluster content)
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

function extractIndexedItems(chunk: XmlChunk, itemName: string): string[] {
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

	// Filter out any undefined slots and return
	return result.filter((x): x is string => x !== undefined);
}

function findChunk(parent: XmlChunk, name: string): XmlChunk | undefined {
	const chunks = normalizeArray(parent.chunks?.chunk);
	return chunks.find((c) => c.name === name);
}

function findAllChunks(parent: XmlChunk, name: string): XmlChunk[] {
	const chunks = normalizeArray(parent.chunks?.chunk);
	return chunks.filter((c) => c.name === name);
}

function parseMapping(mappingValue: number): DataMapping {
	// Mapping values: 0=None, 1=Flatten, 2=Graft, 3=Reparametrize
	switch (mappingValue) {
		case 1:
			return "flatten";
		case 2:
			return "graft";
		case 3:
			return "reparametrize";
		default:
			return "none";
	}
}

function parseParamChunk(
	paramChunk: XmlChunk,
	type: "input" | "output"
): InputPort | OutputPort | null {
	const items = extractItems(paramChunk);

	const nickName = items.NickName;
	if (!nickName || typeof nickName !== "string") return null;

	const guid = (items.GUID as string) || "";

	const port: InputPort | OutputPort = {
		description: items.Description as string,
		nick: nickName,
		optional: (items.Optional as boolean) ?? false,
		guid,
	};

	if (type === "input") {
		// Source is an indexed item (Source_0, Source_1, etc.)
		const sources = extractIndexedItems(paramChunk, "Source");
		if (sources.length > 0) {
			(port as InputPort).source = sources[0];
		}
	}

	// Parse parameter options (mapping, simplify, etc.)
	const options: PortOptions = {};
	let hasOptions = false;

	// Mapping: 0=None, 1=Flatten, 2=Graft, 3=Reparametrize
	if (items.Mapping !== undefined) {
		options.mapping = parseMapping(items.Mapping as number);
		hasOptions = true;
	}

	// Simplify data
	if (items.SimplifyData === true) {
		options.simplify = true;
		hasOptions = true;
	}

	// Reverse
	if (items.Reverse === true) {
		options.reverse = true;
		hasOptions = true;
	}

	// Expression applied to this parameter
	if (items.Expression && typeof items.Expression === "string") {
		options.expression = items.Expression as string;
		hasOptions = true;
	}

	if (hasOptions) {
		port.options = options;
	}

	return port;
}

function decodeBase64(encoded: string): string {
	try {
		return Buffer.from(encoded, "base64").toString("utf-8");
	} catch {
		return encoded;
	}
}

function detectScriptLanguage(
	componentType: string,
	scriptChunk: XmlChunk
): string {
	// Check LanguageSpec chunk if available
	const languageSpecChunk = findChunk(scriptChunk, "LanguageSpec");
	if (languageSpecChunk) {
		const items = extractItems(languageSpecChunk);
		const name = items.Name as string;
		if (name) {
			if (name.toLowerCase().includes("python")) return "python";
			if (
				name.toLowerCase().includes("csharp") ||
				name.toLowerCase().includes("c#")
			)
				return "csharp";
			return name.toLowerCase();
		}
	}

	// Fallback to component type detection
	const type = componentType.toLowerCase();
	if (type.includes("python")) return "python";
	if (type.includes("csharp") || type.includes("c#")) return "csharp";
	if (type.includes("vb")) return "vb";

	return "unknown";
}

function parseScript(
	containerChunk: XmlChunk,
	componentType: string
): Component["script"] | undefined {
	const scriptChunk = findChunk(containerChunk, "Script");
	if (!scriptChunk) return undefined;

	const scriptItems = extractItems(scriptChunk);
	const encodedCode = scriptItems.Text as string;
	const title = scriptItems.Title as string;

	if (!encodedCode) return undefined;

	const language = detectScriptLanguage(componentType, scriptChunk);
	const code = decodeBase64(encodedCode);

	return {
		language,
		code,
		title,
	};
}

function parseComponentValue(
	containerChunk: XmlChunk,
	componentType: string,
	containerItems: Record<string, unknown>
): Component["value"] | undefined {
	const type = componentType.toLowerCase();

	// Parse Slider values
	if (type.includes("slider")) {
		const sliderChunk = findChunk(containerChunk, "Slider");
		if (sliderChunk) {
			const sliderItems = extractItems(sliderChunk);
			return {
				type: "slider",
				min: sliderItems.Min as number,
				max: sliderItems.Max as number,
				current: sliderItems.Value as number,
				digits: sliderItems.Digits as number,
				interval: sliderItems.Interval as number,
			};
		}
	}

	// Parse Panel text
	if (type.includes("panel")) {
		const text = containerItems.UserText as string;
		if (text !== undefined) {
			return {
				type: "panel",
				text,
			};
		}
	}

	// Parse Value List
	if (type.includes("value list")) {
		const listItems = findAllChunks(containerChunk, "ListItem");
		if (listItems.length > 0) {
			const items = listItems.map((item) => {
				const itemData = extractItems(item);
				return {
					name: itemData.Name as string,
					expression: itemData.Expression as string,
					selected: itemData.Selected === true,
				};
			});

			const selectedIndex = items.findIndex((item) => item.selected);

			return {
				type: "valueList",
				items,
				selectedIndex: selectedIndex >= 0 ? selectedIndex : undefined,
			};
		}
	}

	// Parse Get Number / other numeric inputs
	if (
		containerItems.Minimum !== undefined &&
		containerItems.Maximum !== undefined
	) {
		return {
			type: "number",
			min: containerItems.Minimum as number,
			max: containerItems.Maximum as number,
			current: containerItems.Value as number,
		};
	}

	// Parse generic text value
	if (
		containerItems.Value !== undefined &&
		typeof containerItems.Value === "string"
	) {
		return {
			type: "text",
			text: containerItems.Value,
		};
	}

	return undefined;
}

function parseVisuals(
	containerChunk: XmlChunk,
	containerItems: Record<string, unknown>
): Visuals | undefined {
	const visuals: Visuals = {};
	let hasVisuals = false;

	// Parse bounds from Attributes chunk
	const attributesChunk = findChunk(containerChunk, "Attributes");
	if (attributesChunk) {
		const attrItems = extractItems(attributesChunk);

		if (attrItems.Bounds) {
			const bounds = attrItems.Bounds as {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			visuals.bounds = bounds;
			hasVisuals = true;
		}

		if (attrItems.Pivot) {
			const pivot = attrItems.Pivot as { x: number; y: number };
			visuals.pivot = pivot;
			hasVisuals = true;
		}
	}

	// Parse color from container items (for groups)
	if (containerItems.Colour) {
		visuals.color = containerItems.Colour as string;
		hasVisuals = true;
	}

	return hasVisuals ? visuals : undefined;
}

function parseComponentState(
	containerItems: Record<string, unknown>
): ComponentState | undefined {
	const state: ComponentState = {};
	let hasState = false;

	if (containerItems.Hidden !== undefined) {
		state.hidden = containerItems.Hidden === true;
		hasState = true;
	}

	if (containerItems.Locked !== undefined) {
		state.locked = containerItems.Locked === true;
		hasState = true;
	}

	// Frozen is typically in container items
	if (containerItems.Frozen !== undefined) {
		state.frozen = containerItems.Frozen === true;
		hasState = true;
	}

	// Selected is typically in Attributes
	if (containerItems.Selected !== undefined) {
		state.selected = containerItems.Selected === true;
		hasState = true;
	}

	return hasState ? state : undefined;
}

function parseComponent(
	objectChunk: XmlChunk,
	options?: ParseOptions,
	libraryMap?: Map<string, string>
): ParsedComponent | null {
	const items = extractItems(objectChunk);
	const guid = items.GUID as string;
	const name = items.Name as string;
	const libGuid = items.Lib as string | undefined;

	if (!guid || !name) {
		return null;
	}

	const containerChunk = findChunk(objectChunk, "Container");
	if (!containerChunk) {
		return null;
	}

	const containerItems = extractItems(containerChunk);
	const instanceGuid = (containerItems.InstanceGuid as string) || guid;
	const nickName = (containerItems.NickName as string) || name;

	const libraryName =
		libGuid && libraryMap ? libraryMap.get(libGuid) : undefined;

	const component: Component = {
		id: "", // Will be set by caller
		type: name,
		guid: instanceGuid,
		library: libraryName,
		description: containerItems.Description as string,
		nickName: nickName,
		inputs: {},
		outputs: {},
	};

	// Find ParameterData chunk
	const paramDataChunk = findChunk(containerChunk, "ParameterData");
	if (paramDataChunk) {
		const paramDataItems = extractItems(paramDataChunk);

		const inputCount = (paramDataItems.InputCount as number) || 0;
		const inputParams = findAllChunks(paramDataChunk, "InputParam");

		for (let i = 0; i < inputCount && i < inputParams.length; i++) {
			const param = parseParamChunk(inputParams[i], "input");
			if (param && param.nick) {
				const key = String(param.nick).toLowerCase();
				component.inputs[key] = param;
			}
		}

		const outputCount = (paramDataItems.OutputCount as number) || 0;
		const outputParams = findAllChunks(paramDataChunk, "OutputParam");

		for (let i = 0; i < outputCount && i < outputParams.length; i++) {
			const param = parseParamChunk(outputParams[i], "output");
			if (param && param.nick) {
				const key = String(param.nick).toLowerCase();
				component.outputs[key] = param;
			}
		}
	}

	// Also check for param_input and param_output chunks directly in container
	// (some components like Evaluate Surface use this format)
	const paramInputs = findAllChunks(containerChunk, "param_input");
	for (const paramChunk of paramInputs) {
		const param = parseParamChunk(paramChunk, "input");
		if (param && param.nick) {
			const key = String(param.nick).toLowerCase();
			// Only add if not already present from ParameterData
			if (!component.inputs[key]) {
				component.inputs[key] = param;
			}
		}
	}

	const paramOutputs = findAllChunks(containerChunk, "param_output");
	for (const paramChunk of paramOutputs) {
		const param = parseParamChunk(paramChunk, "output");
		if (param && param.nick) {
			const key = String(param.nick).toLowerCase();
			// Only add if not already present from ParameterData
			if (!component.outputs[key]) {
				component.outputs[key] = param;
			}
		}
	}

	// Handle container-level sources for primitive components (e.g., Text, Number Slider)
	// These don't have ParameterData but have Source directly in Container
	const sourceGuids = extractIndexedItems(containerChunk, "Source");
	if (sourceGuids.length > 0 && Object.keys(component.inputs).length === 0) {
		// Create a default input for components with container-level sources
		component.inputs["value"] = {
			description: "Input value",
			nick: "V",
			optional: true,
			source: sourceGuids[0],
			guid: instanceGuid,
		};
	}

	// Parse script if present
	const script = parseScript(containerChunk, name);
	if (script) {
		component.script = script;
	}

	// Parse expression if present (for Expression components)
	if (containerItems.Expression) {
		component.expression = String(containerItems.Expression);
	}

	// Parse internal expression if present (e.g., Number component with x/2)
	if (containerItems.InternalExpression) {
		component.internalExpression = String(containerItems.InternalExpression);
	}

	// Parse component value (for sliders, panels, value lists, etc.)
	const value = parseComponentValue(containerChunk, name, containerItems);
	if (value) {
		component.value = value;
	}

	// Parse cluster data if present (for Cluster components)
	const clusterData = containerItems.ClusterDocument as
		| { data: string; size: number }
		| undefined;
	if (clusterData) {
		component.cluster = {
			data: clusterData.data,
			size: clusterData.size,
		};
	}

	// Parse visuals if option is enabled
	if (options?.includeVisuals) {
		const visuals = parseVisuals(containerChunk, containerItems);
		if (visuals) {
			component.visuals = visuals;
		}

		const state = parseComponentState(containerItems);
		if (state) {
			component.state = state;
		}
	}

	return { component, guid: instanceGuid, objectChunk };
}

export function parseGrasshopper(
	xmlData: ParsedXml,
	options?: ParseOptions
): ParsedGrasshopper {
	const archive = xmlData.Archive;
	if (!archive) {
		throw new Error("Invalid XML: Missing Archive root");
	}

	// Extract version
	const items = normalizeArray(archive.items?.item);
	const versionItem = items.find((i) => i.name === "ArchiveVersion");
	const version = versionItem
		? `${versionItem.Major}.${versionItem.Minor}.${versionItem.Revision}`
		: "0.0.0";

	const chunks = normalizeArray(archive.chunks?.chunk);

	const defChunk = chunks.find((c) => c.name === "Definition");

	const definitionChunks = (() => {
		if (defChunk) {
			const inner = normalizeArray(defChunk.chunks?.chunk);
			return inner;
		}
		return chunks;
	})();

	const definitionObjectsChunk = definitionChunks.find(
		(c) => c.name === "DefinitionObjects"
	);

	if (!definitionObjectsChunk) {
		return {
			version,
			components: {},
			wires: [],
		};
	}

	// Parse components with unique IDs
	const objectChunks = findAllChunks(definitionObjectsChunk, "Object");
	console.log("[parseGrasshopper] Object chunks found:", objectChunks.length);

	// Build library map from GHALibraries (moved before component parsing)
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
	const nickNameCounts: Map<string, number> = new Map();

	// First pass: generate unique IDs and build GUID mapping
	const parsedComponents: Array<{ parsed: ParsedComponent; id: string }> = [];

	for (const objectChunk of objectChunks) {
		const parsed = parseComponent(objectChunk, options, libraryMap);
		if (!parsed) {
			continue;
		}

		const baseNick = parsed.component.nickName || parsed.component.type;
		const count = (nickNameCounts.get(baseNick) || 0) + 1;
		nickNameCounts.set(baseNick, count);

		const uniqueId = count === 1 ? baseNick : `${baseNick}_${count}`;
		parsed.component.id = uniqueId;

		components[uniqueId] = parsed.component;
		guidToId.set(parsed.guid, uniqueId);

		// Also map InstanceGuid if it exists and is different
		const containerChunk = findChunk(objectChunk, "Container");
		if (containerChunk) {
			const containerItems = extractItems(containerChunk);
			const instanceGuid = containerItems.InstanceGuid as string;
			if (instanceGuid && instanceGuid !== parsed.guid) {
				guidToId.set(instanceGuid, uniqueId);
			}
		}

		parsedComponents.push({ parsed, id: uniqueId });
	}

	// Build wires from input sources
	const wires: Wire[] = [];

	for (const { id: compId, parsed } of parsedComponents) {
		const component = parsed.component;
		for (const [inputName, input] of Object.entries(component.inputs)) {
			if (input.source) {
				const sourceComponentId = guidToId.get(input.source);

				if (sourceComponentId) {
					wires.push({
						from: sourceComponentId,
						to: `${compId}.${inputName}`,
					});
					// Update the input source to reference the component ID instead of GUID
					input.source = sourceComponentId;
				} else {
					wires.push({
						from: input.source,
						to: `${compId}.${inputName}`,
					});
				}
			}
		}
	}

	// Resolve group members
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

	// Extract metadata
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
				version: "",
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

export function buildGhJson(
	xmlContent: string,
	options?: ParseOptions
): ParsedGrasshopper {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "",
		parseAttributeValue: false,
		parseTagValue: false,
		trimValues: true,
		isArray: (name) => {
			return ["item", "chunk"].includes(name);
		},
	});

	const parsed = parser.parse(xmlContent) as ParsedXml;
	return parseGrasshopper(parsed, options);
}
