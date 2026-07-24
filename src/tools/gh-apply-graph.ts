import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { executeApplyGraph, formatApplyGraphResult } from "../services/gh-apply-graph.js";
import {
	AccessType,
	DataMappingType,
	PanelTextOutputType,
	TypeHintType,
} from "./edit-tools/shared-types.js";
import type { ApplyGraphInput } from "../types/gh-apply-graph.js";

const Ref = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" });
const Coordinate = Type.Number({ minimum: 20 });
const Name = Type.Optional(Type.String());
const Port = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);
const Endpoint = Type.Tuple([Ref, Port]);
const Position = {
	ref: Ref,
	x: Coordinate,
	y: Coordinate,
	name: Name,
};

const Component = Type.Object({
	...Position,
	type: Type.String({ minLength: 1 }),
	preview: Type.Optional(Type.Boolean()),
});

const Slider = Type.Object({
	...Position,
	kind: Type.Literal("slider"),
	min: Type.Number(),
	max: Type.Number(),
	value: Type.Number(),
	digits: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
});
const Panel = Type.Object({
	...Position,
	kind: Type.Literal("panel"),
	text: Type.String(),
	textOutput: Type.Optional(PanelTextOutputType),
	width: Type.Optional(Type.Number({ minimum: 1 })),
	height: Type.Optional(Type.Number({ minimum: 1 })),
	bgColor: Type.Optional(Type.String()),
});
const Toggle = Type.Object({ ...Position, kind: Type.Literal("toggle"), value: Type.Boolean() });
const Swatch = Type.Object({ ...Position, kind: Type.Literal("swatch"), color: Type.String() });
const Scribble = Type.Object({
	...Position,
	kind: Type.Literal("scribble"),
	text: Type.String(),
	size: Type.Optional(Type.Number({ minimum: 1 })),
});
const ValueList = Type.Object({
	...Position,
	kind: Type.Literal("valueList"),
	items: Type.Array(Type.Object({ name: Type.String(), value: Type.String() }), { minItems: 1 }),
	selectedIndex: Type.Optional(Type.Integer({ minimum: 0 })),
});

const ScriptParts = Type.Object({
	references: Type.Optional(Type.Array(Type.String())),
	runScript: Type.String(),
	helpers: Type.Optional(Type.String()),
});
const ScriptPort = Type.Object({
	name: Type.String(),
	previousName: Type.Optional(Type.String()),
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean()),
	reverse: Type.Optional(Type.Boolean()),
});
const Script = Type.Object({
	...Position,
	language: Type.Union([Type.Literal("csharp"), Type.Literal("python")]),
	code: Type.Optional(Type.String()),
	scriptParts: Type.Optional(ScriptParts),
	inputs: Type.Optional(Type.Array(ScriptPort)),
	outputs: Type.Optional(Type.Array(ScriptPort)),
});

export const ghApplyGraphTool = defineTool({
	name: "gh_apply_graph",
	label: "Apply Graph",
	description:
		"Atomically create a new Grasshopper subgraph with local refs, including components, widgets, scripts, wires, and groups; validation is included.",
	promptSnippet: "Create and validate a complete Grasshopper subgraph in one call",
	parameters: Type.Object({
		components: Type.Optional(Type.Array(Component)),
		widgets: Type.Optional(Type.Array(Type.Union([Slider, Panel, Toggle, Swatch, Scribble, ValueList]))),
		scripts: Type.Optional(Type.Array(Script)),
		wires: Type.Optional(Type.Array(Type.Object({ from: Endpoint, to: Endpoint }))),
		groups: Type.Optional(Type.Array(Type.Object({
			name: Type.String({ minLength: 1 }),
			refs: Type.Array(Ref, { minItems: 1 }),
			color: Type.Optional(Type.String()),
			border: Type.Optional(Type.Union([
				Type.Literal("Box"),
				Type.Literal("Blob"),
				Type.Literal("Rectangles"),
			])),
		}))),
	}),
	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({
			content: [{ type: "text", text: "Applying Grasshopper graph..." }],
			details: {},
		});
		const result = await executeApplyGraph(params as ApplyGraphInput);
		return {
			content: [{ type: "text", text: formatApplyGraphResult(result) }],
			details: result,
		};
	},
});
