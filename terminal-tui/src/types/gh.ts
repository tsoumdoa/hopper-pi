export type Wire = {
	from: string;
	to: string;
	style?: WireStyle;
};

export type WireStyle = "normal" | "faint" | "hidden";

export type DataMapping =
	| "none"
	| "flatten"
	| "graft"
	| "simplify"
	| "reparametrize";

export type PortOptions = {
	mapping?: DataMapping;
	simplify?: boolean;
	reverse?: boolean;
	expression?: string;
};

export type InputPort = {
	description?: string;
	nick: string;
	source?: string;
	optional?: boolean;
	options?: PortOptions;
	guid: string;
};

export type OutputPort = {
	description?: string;
	nick: string;
	optional?: boolean;
	options?: PortOptions;
	guid: string;
};

export type Visuals = {
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
	color?: string;
	zIndex?: number;
};

export type ComponentState = {
	hidden?: boolean;
	locked?: boolean;
	frozen?: boolean;
	selected?: boolean;
};

export type Component = {
	id: string;
	type: string;
	guid: string;
	library?: string;
	description?: string;
	nickName: string;
	inputs: Record<string, InputPort>;
	outputs: Record<string, OutputPort>;
	script?: {
		language?: string;
		code: string;
		title?: string;
	};
	members?: string[];
	expression?: string;
	internalExpression?: string;
	value?: ComponentValue;
	cluster?: {
		data: string;
		size: number;
	};
	visuals?: Visuals;
	state?: ComponentState;
};

export type ComponentValue = {
	type: "slider" | "panel" | "valueList" | "number" | "text";
	min?: number;
	max?: number;
	current?: number;
	digits?: number;
	interval?: number;
	text?: string;
	items?: Array<{
		name: string;
		expression: string;
		selected: boolean;
	}>;
	selectedIndex?: number;
};

export type ParsedGrasshopper = {
	version: string;
	components: Record<string, Component>;
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
};

export type ParseOptions = {
	includeVisuals: boolean;
};
