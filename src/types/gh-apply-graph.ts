import type { CsharpScriptPartsInput } from "./csharp-script.js";
import type { CanvasError } from "./messages.js";
import type { ScriptIOParam } from "./commands.js";
import type { CanvasOverlapResult } from "../tools/canvas-checks.js";

export type GraphPortSelector = string | number;
export type GraphEndpoint = [ref: string, port: GraphPortSelector];

export type GraphComponentNode = {
	ref: string;
	type: string;
	x: number;
	y: number;
	name?: string;
	preview?: boolean;
};

type GraphWidgetBase = {
	ref: string;
	x: number;
	y: number;
	name?: string;
};

export type GraphWidgetNode =
	| (GraphWidgetBase & {
		kind: "slider";
		min: number;
		max: number;
		value: number;
		digits?: number;
	})
	| (GraphWidgetBase & {
		kind: "panel";
		text: string;
		textOutput?: "singleString" | "oneItemPerLine";
		width?: number;
		height?: number;
		bgColor?: string;
	})
	| (GraphWidgetBase & { kind: "toggle"; value: boolean })
	| (GraphWidgetBase & { kind: "swatch"; color: string })
	| (GraphWidgetBase & { kind: "scribble"; text: string; size?: number })
	| (GraphWidgetBase & {
		kind: "valueList";
		items: Array<{ name: string; value: string }>;
		selectedIndex?: number;
	});

export type GraphScriptNode = {
	ref: string;
	language: "csharp" | "python";
	x: number;
	y: number;
	name?: string;
	code?: string;
	scriptParts?: CsharpScriptPartsInput;
	inputs?: ScriptIOParam[];
	outputs?: ScriptIOParam[];
};

export type GraphWire = {
	from: GraphEndpoint;
	to: GraphEndpoint;
};

export type GraphGroup = {
	name: string;
	refs: string[];
	color?: string;
	border?: "Box" | "Blob" | "Rectangles";
};

export type ApplyGraphInput = {
	components?: GraphComponentNode[];
	widgets?: GraphWidgetNode[];
	scripts?: GraphScriptNode[];
	wires?: GraphWire[];
	groups?: GraphGroup[];
};

export type StructuralError = {
	path: string;
	code: string;
	message: string;
	candidates?: string[];
};

export type NormalizedGraphComponent = Omit<GraphComponentNode, "type"> & {
	typeGuid: string;
};

export type NormalizedGraphScript = Omit<GraphScriptNode, "scriptParts"> & {
	code: string;
};

export type NormalizedApplyGraphRequest = {
	type: "applyGraph";
	components: NormalizedGraphComponent[];
	widgets: GraphWidgetNode[];
	scripts: NormalizedGraphScript[];
	wires: GraphWire[];
	groups: GraphGroup[];
};

export type ApplyGraphBackendResponse = {
	type: "applyGraph.response";
	timestamp: number;
	ok: boolean;
	rolledBack: boolean;
	/** True when the apply exceeded the UI-thread window; the canvas outcome is unknown. */
	timedOut: boolean;
	counts: {
		components: number;
		widgets: number;
		scripts: number;
		wires: number;
		groups: number;
	};
	refs: Record<string, string>;
	structuralErrors: StructuralError[];
	elapsedMs: number;
};

export type ApplyGraphResult = Omit<ApplyGraphBackendResponse, "type" | "timestamp" | "refs"> & {
	refs: Record<string, string>;
	runtimeMessages: CanvasError[];
	overlaps: CanvasOverlapResult | null;
};
