import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { executeApplyGraph, formatApplyGraphResult } from "../services/gh-apply-graph.js";
import {
	AccessType,
	DataMappingType,
	PanelTextOutputType,
	TypeHintType,
} from "./edit-tools/shared-types.js";
import type { ApplyGraphInput, GraphEndpoint } from "../types/gh-apply-graph.js";

const Ref = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" });
const Coordinate = Type.Number({ minimum: 20 });
const Name = Type.Optional(Type.String());
const Port = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);
// Type.Tuple emits draft-07 `items: [...]` + `additionalItems`, which Anthropic
// rejects (requires draft 2020-12 `prefixItems`). Keep the `[ref, port]` wire shape.
const Endpoint = Type.Unsafe<GraphEndpoint>({
	type: "array",
	prefixItems: [Ref, Port],
	minItems: 2,
	maxItems: 2,
	items: false,
});
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

const Widget = Type.Object({
	...Position,
	kind: Type.Union([
		Type.Literal("slider"),
		Type.Literal("panel"),
		Type.Literal("toggle"),
		Type.Literal("swatch"),
		Type.Literal("scribble"),
		Type.Literal("valueList"),
	]),
	min: Type.Optional(Type.Number()),
	max: Type.Optional(Type.Number()),
	value: Type.Optional(Type.Union([Type.Number(), Type.Boolean()])),
	digits: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
	text: Type.Optional(Type.String()),
	textOutput: Type.Optional(PanelTextOutputType),
	width: Type.Optional(Type.Number({ minimum: 1 })),
	height: Type.Optional(Type.Number({ minimum: 1 })),
	bgColor: Type.Optional(Type.String()),
	color: Type.Optional(Type.String()),
	size: Type.Optional(Type.Number({ minimum: 1 })),
	items: Type.Optional(Type.Array(
		Type.Object({ name: Type.String(), value: Type.String() }),
		{ minItems: 1 },
	)),
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
	parameters: Type.Object({
		components: Type.Optional(Type.Array(Component)),
		widgets: Type.Optional(Type.Array(Widget)),
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
