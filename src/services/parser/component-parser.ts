import type {
	Component,
	InputPort,
	OutputPort,
	Visuals,
	ComponentState,
	DataMapping,
	PortOptions,
} from "../../types/gh.js";
import type { XmlChunk, ParsedComponent } from "../../types/parser.js";
import {
	extractItems,
	extractIndexedItems,
	findChunk,
	findAllChunks,
} from "./xml-utils.js";

function parseMapping(mappingValue: number): DataMapping {
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
	type: "input" | "output",
	options?: { includeVisuals?: boolean }
): InputPort | OutputPort | null {
	const items = extractItems(paramChunk);

	const nickName = items.NickName;
	if (!nickName || typeof nickName !== "string") return null;

	const instanceGuid = (items.InstanceGuid as string) || "";

	const port: InputPort | OutputPort = {
		description: items.Description as string,
		nick: nickName,
		optional: (items.Optional as boolean) ?? false,
		instanceGuid,
	};

	if (type === "input") {
		const sources = extractIndexedItems(paramChunk, "Source");
		if (sources.length > 0) {
			(port as InputPort).source = sources[0];
			if (sources.length > 1) {
				(port as InputPort).sources = sources;
			}
		}
	}

	const portOptions: PortOptions = {};
	let hasOptions = false;

	if (items.Mapping !== undefined) {
		portOptions.mapping = parseMapping(items.Mapping as number);
		hasOptions = true;
	}

	if (items.SimplifyData === true) {
		portOptions.simplify = true;
		hasOptions = true;
	}

	if (items.Reverse === true) {
		portOptions.reverse = true;
		hasOptions = true;
	}

	if (items.Expression && typeof items.Expression === "string") {
		portOptions.expression = items.Expression as string;
		hasOptions = true;
	}

	if (hasOptions) {
		port.options = portOptions;
	}

	if (options?.includeVisuals !== false) {
		const attributesChunk = findChunk(paramChunk, "Attributes");
		if (attributesChunk) {
			const attrItems = extractItems(attributesChunk);

			if (attrItems.Pivot) {
				port.pivot = attrItems.Pivot as { x: number; y: number };
			}

			if (attrItems.Bounds) {
				const b = attrItems.Bounds as { width: number; height: number; x: number; y: number };
				port.bounds = { width: b.width, height: b.height };
			}
		}
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

export function parseComponentValue(
	containerChunk: XmlChunk,
	componentType: string,
	containerItems: Record<string, unknown>
): Component["value"] | undefined {
	const type = componentType.toLowerCase();

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

	if (type.includes("panel")) {
		const text = containerItems.UserText as string;
		if (text !== undefined) {
			return {
				type: "panel",
				text,
			};
		}
	}

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

	if (type.includes("toggle")) {
		const toggleValue = containerItems.ToggleValue;
		if (toggleValue !== undefined) {
			return {
				type: "toggle",
				value: toggleValue === true,
			};
		}
	}

	if (type.includes("swatch")) {
		const swatchColor = containerItems.SwatchColor;
		if (swatchColor !== undefined) {
			return {
				type: "swatch",
				color: swatchColor as string,
			};
		}
	}

	if (type.includes("button")) {
		const normalExpr = containerItems.ExpressionNormal as string;
		const pressedExpr = containerItems.ExpressionPressed as string;
		return {
			type: "button",
			normalExpression: normalExpr,
			pressedExpression: pressedExpr,
		};
	}

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

	if (containerItems.Colour) {
		visuals.color = containerItems.Colour as string;
		hasVisuals = true;
	}

	return hasVisuals ? visuals : undefined;
}

export function parseComponentState(
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

	if (containerItems.Frozen !== undefined) {
		state.frozen = containerItems.Frozen === true;
		hasState = true;
	}

	if (containerItems.Selected !== undefined) {
		state.selected = containerItems.Selected === true;
		hasState = true;
	}

	return hasState ? state : undefined;
}

export function parseComponent(
	objectChunk: XmlChunk,
	libraryMap?: Map<string, string>
): ParsedComponent | null {
	const items = extractItems(objectChunk);
	const typeGuid = items.GUID as string;
	const name = items.Name as string;
	const libGuid = items.Lib as string | undefined;

	if (!typeGuid || !name) {
		return null;
	}

	const containerChunk = findChunk(objectChunk, "Container");
	if (!containerChunk) {
		return null;
	}

	const containerItems = extractItems(containerChunk);
	const instanceGuid = (containerItems.InstanceGuid as string) || typeGuid;
	const nickName = (containerItems.NickName as string) || name;

	const libraryName =
		libGuid && libraryMap ? libraryMap.get(libGuid) : undefined;

	const component: Component = {
		id: "",
		type: name,
		typeGuid,
		instanceGuid: instanceGuid,
		library: libraryName,
		description: containerItems.Description as string,
		nickName: nickName,
		inputs: {},
		outputs: {},
	};

	const paramDataChunk = findChunk(containerChunk, "ParameterData");
	if (paramDataChunk) {
		const paramDataItems = extractItems(paramDataChunk);

		const inputCount = (paramDataItems.InputCount as number) || 0;
		const inputParams = findAllChunks(paramDataChunk, "InputParam");

		for (let i = 0; i < inputCount && i < inputParams.length; i++) {
			const param = parseParamChunk(inputParams[i], "input", { includeVisuals: true });
			if (param && param.nick) {
				const key = String(param.nick).toLowerCase();
				component.inputs[key] = param;
			}
		}

		const outputCount = (paramDataItems.OutputCount as number) || 0;
		const outputParams = findAllChunks(paramDataChunk, "OutputParam");

		for (let i = 0; i < outputCount && i < outputParams.length; i++) {
			const param = parseParamChunk(outputParams[i], "output", { includeVisuals: true });
			if (param && param.nick) {
				const key = String(param.nick).toLowerCase();
				component.outputs[key] = param;
			}
		}
	}

	const seenInputKeys = new Set<string>();
	const paramInputs = findAllChunks(containerChunk, "param_input");
	for (const paramChunk of paramInputs) {
		const param = parseParamChunk(paramChunk, "input", { includeVisuals: true });
		if (param && param.nick) {
			let key = String(param.nick).toLowerCase();
			if (seenInputKeys.has(key)) {
				key = `${key}_${paramChunk.index ?? seenInputKeys.size}`;
			}
			seenInputKeys.add(key);
			component.inputs[key] = param;
		}
	}

	const seenOutputKeys = new Set<string>();
	const paramOutputs = findAllChunks(containerChunk, "param_output");
	for (const paramChunk of paramOutputs) {
		const param = parseParamChunk(paramChunk, "output", { includeVisuals: true });
		if (param && param.nick) {
			let key = String(param.nick).toLowerCase();
			if (seenOutputKeys.has(key)) {
				key = `${key}_${paramChunk.index ?? seenOutputKeys.size}`;
			}
			seenOutputKeys.add(key);
			component.outputs[key] = param;
		}
	}

	const sourceGuids = extractIndexedItems(containerChunk, "Source");
	if (sourceGuids.length > 0 && Object.keys(component.inputs).length === 0) {
		component.inputs["value"] = {
			description: "Input value",
			nick: "V",
			optional: true,
			source: sourceGuids[0],
			instanceGuid: instanceGuid,
		};
	}

	if (Object.keys(component.outputs).length === 0) {
		component.outputs["value"] = {
			nick: "V",
			instanceGuid: instanceGuid,
		};
	}

	const script = parseScript(containerChunk, name);
	if (script) {
		component.script = script;
	}

	if (containerItems.Expression) {
		component.expression = String(containerItems.Expression);
	}

	if (containerItems.InternalExpression) {
		component.internalExpression = String(containerItems.InternalExpression);
	}

	const value = parseComponentValue(containerChunk, name, containerItems);
	if (value) {
		component.value = value;
	}

	const clusterData = containerItems.ClusterDocument as
		| { data: string; size: number }
		| undefined;
	if (clusterData) {
		component.cluster = {
			data: clusterData.data,
			size: clusterData.size,
		};
	}

	const visuals = parseVisuals(containerChunk, containerItems);
	if (visuals) {
		component.visuals = visuals;
	}

	const state = parseComponentState(containerItems);
	if (state) {
		component.state = state;
	}

	return { component, instanceGuid: instanceGuid, objectChunk };
}
