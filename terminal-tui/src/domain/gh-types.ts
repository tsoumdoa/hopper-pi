export interface Wire {
	from: string;
	to: string;
	style?: WireStyle; // Only included with --visuals flag
}

export type WireStyle = "normal" | "faint" | "hidden";

export type DataMapping =
	| "none"
	| "flatten"
	| "graft"
	| "simplify"
	| "reparametrize";

export interface PortOptions {
	mapping?: DataMapping; // Tree mapping: flatten, graft, etc.
	simplify?: boolean; // Simplify data option
	reverse?: boolean; // Reverse list option
	expression?: string; // Expression applied to this port
}

export interface InputPort {
	description?: string;
	nick: string;
	source?: string;
	optional?: boolean;
	options?: PortOptions;
	guid: string;
}

export interface OutputPort {
	description?: string;
	nick: string;
	optional?: boolean;
	options?: PortOptions;
	guid: string;
}

export interface Visuals {
	bounds?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	pivot?: {
		x: number;
		y: number;
	};
	color?: string; // ARGB format: "255;255;38;0"
	zIndex?: number;
}

export interface ComponentState {
	hidden?: boolean;
	locked?: boolean;
	frozen?: boolean;
	selected?: boolean;
}

export interface Component {
	id: string; // Unique identifier (e.g., "Area_1", "Brep_2")
	type: string; // Component type (e.g., "Area", "Brep")
	guid: string; // Original InstanceGuid
	library?: string; // Library name (from Lib GUID mapping)
	description?: string;
	nickName: string; // Display name (may have duplicates)
	inputs: Record<string, InputPort>;
	outputs: Record<string, OutputPort>;
	script?: {
		language?: string; // e.g., "python", "csharp"
		code: string; // Decoded source code
		title?: string; // Script title/name
	};
	members?: string[]; // For Group components: list of component IDs in the group
	expression?: string; // For Expression components: the expression formula
	internalExpression?: string; // For components with internal expressions (e.g., Number with x/2)
	value?: ComponentValue; // For input components: slider values, panel text, value list items, etc.
	cluster?: {
		data: string; // Base64 encoded cluster content (compressed/binary)
		size: number; // Original size in bytes
	};
	visuals?: Visuals; // Only included with --visuals flag
	state?: ComponentState; // Only included with --visuals flag
}

export interface ComponentValue {
	type: "slider" | "panel" | "valueList" | "number" | "text";
	// Slider specific
	min?: number;
	max?: number;
	current?: number;
	digits?: number;
	interval?: number;
	// Panel/Text specific
	text?: string;
	// Value List specific
	items?: Array<{
		name: string;
		expression: string;
		selected: boolean;
	}>;
	selectedIndex?: number;
}

export interface ParsedGrasshopper {
	version: string;
	components: Record<string, Component>; // Keyed by unique id
	wires: Wire[];
	metadata?: {
		pluginVersion?: string;
		documentId?: string;
		libraries?: Array<{
			name: string;
			version: string;
			author?: string;
		}>;
	};
}

export interface ParseOptions {
	includeVisuals: boolean;
}
