import { Type, type Static, type TSchema } from "@sinclair/typebox";

const strict = { additionalProperties: false } as const;

export const DocumentTargetSchema = Type.Object({
	backendInstanceId: Type.String({ minLength: 1 }),
	ghDocument: Type.Union([
		Type.Object({
			path: Type.Union([Type.String(), Type.Null()]),
			runtimeId: Type.String({ minLength: 1 }),
		}, strict),
		Type.Null(),
	]),
	rhinoDocument: Type.Union([
		Type.Object({
			name: Type.String(),
			runtimeSerialNumber: Type.Integer({ minimum: 0 }),
		}, strict),
		Type.Null(),
	]),
}, strict);

export const GhGetCanvasInputSchema = Type.Object({
	subgraph: Type.Optional(Type.String()),
	selectionOnly: Type.Optional(Type.Boolean()),
}, strict);

export const GhListComponentsInputSchema = Type.Object({
	queries: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	searchFrom: Type.Optional(Type.Union([
		Type.Literal("all"),
		Type.Literal("vanilla"),
		Type.Literal("plugin"),
		Type.Literal("params"),
	])),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
}, strict);

const Ref = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" });
const Position = {
	ref: Ref,
	x: Type.Number({ minimum: 20 }),
	y: Type.Number({ minimum: 20 }),
	name: Type.Optional(Type.String()),
};
const Port = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);
const Endpoint = Type.Unsafe({
	type: "array",
	prefixItems: [Ref, Port],
	items: false,
	minItems: 2,
	maxItems: 2,
});
const ScriptPort = Type.Object({
	name: Type.String(),
	previousName: Type.Optional(Type.String()),
	typeHint: Type.Optional(Type.Union([
		Type.Literal("object"), Type.Literal("double"), Type.Literal("int"), Type.Literal("integer"),
		Type.Literal("string"), Type.Literal("bool"), Type.Literal("boolean"),
	])),
	access: Type.Optional(Type.Union([Type.Literal("item"), Type.Literal("list"), Type.Literal("tree")])),
	dataMapping: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("flatten"), Type.Literal("graft")])),
	simplify: Type.Optional(Type.Boolean()),
	reverse: Type.Optional(Type.Boolean()),
}, strict);

export const GhApplyGraphInputSchema = Type.Object({
	components: Type.Optional(Type.Array(Type.Object({
		...Position,
		type: Type.String({ minLength: 1 }),
		preview: Type.Optional(Type.Boolean()),
	}, strict))),
	widgets: Type.Optional(Type.Array(Type.Union([
		Type.Object({ ...Position, kind: Type.Literal("slider"), min: Type.Number(), max: Type.Number(), value: Type.Number(), digits: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })) }, strict),
		Type.Object({ ...Position, kind: Type.Literal("panel"), text: Type.String(), textOutput: Type.Optional(Type.Union([Type.Literal("singleString"), Type.Literal("oneItemPerLine")])), width: Type.Optional(Type.Number({ minimum: 1 })), height: Type.Optional(Type.Number({ minimum: 1 })), bgColor: Type.Optional(Type.String()) }, strict),
		Type.Object({ ...Position, kind: Type.Literal("toggle"), value: Type.Boolean() }, strict),
		Type.Object({ ...Position, kind: Type.Literal("swatch"), color: Type.String() }, strict),
		Type.Object({ ...Position, kind: Type.Literal("scribble"), text: Type.String(), size: Type.Optional(Type.Number({ minimum: 1 })) }, strict),
		Type.Object({ ...Position, kind: Type.Literal("valueList"), items: Type.Array(Type.Object({ name: Type.String(), value: Type.String() }, strict), { minItems: 1 }), selectedIndex: Type.Optional(Type.Integer({ minimum: 0 })) }, strict),
	]))),
	scripts: Type.Optional(Type.Array(Type.Object({
		...Position,
		language: Type.Union([Type.Literal("csharp"), Type.Literal("python")]),
		code: Type.Optional(Type.String()),
		scriptParts: Type.Optional(Type.Object({
			references: Type.Optional(Type.Array(Type.String())),
			runScript: Type.String(),
			helpers: Type.Optional(Type.String()),
		}, strict)),
		inputs: Type.Optional(Type.Array(ScriptPort)),
		outputs: Type.Optional(Type.Array(ScriptPort)),
	}, strict))),
	wires: Type.Optional(Type.Array(Type.Object({ from: Endpoint, to: Endpoint }, strict))),
	groups: Type.Optional(Type.Array(Type.Object({
		name: Type.String({ minLength: 1 }),
		refs: Type.Array(Ref, { minItems: 1 }),
		color: Type.Optional(Type.String()),
		border: Type.Optional(Type.Union([Type.Literal("Box"), Type.Literal("Blob"), Type.Literal("Rectangles")])),
	}, strict))),
}, strict);

export const RhQueryObjectsInputSchema = Type.Object({
	selectionOnly: Type.Optional(Type.Boolean()),
	layer: Type.Optional(Type.String()),
	objectType: Type.Optional(Type.Union([
		Type.Literal("curve"), Type.Literal("point"), Type.Literal("brep"), Type.Literal("surface"), Type.Literal("mesh"),
	])),
	objectIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
	countOnly: Type.Optional(Type.Boolean()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
}, strict);

export const RhRunScriptInputSchema = Type.Object({
	items: Type.Array(Type.Object({
		mode: Type.Union([Type.Literal("command"), Type.Literal("python"), Type.Literal("csharp")]),
		source: Type.String(),
		echo: Type.Optional(Type.Boolean()),
	}, strict), { minItems: 1 }),
}, strict);

const UnknownRecord = Type.Record(Type.String(), Type.Unknown());
export const GhGetCanvasOutputSchema = Type.Object({
	docName: Type.String(),
	componentCount: Type.Integer({ minimum: 0 }),
	wireCount: Type.Integer({ minimum: 0 }),
	subGraphCount: Type.Integer({ minimum: 0 }),
	components: UnknownRecord,
	wires: Type.Array(Type.Unknown()),
	subGraphs: Type.Array(Type.Unknown()),
}, strict);

export const GhListComponentsOutputSchema = Type.Object({
	results: Type.Array(Type.Object({
		query: Type.String(),
		candidates: Type.Array(Type.Object({
			typeGuid: Type.String(),
			name: Type.String(),
			pluginName: Type.String(),
			category: Type.String(),
			subcategory: Type.String(),
			description: Type.String(),
		}, strict)),
		totalMatched: Type.Integer({ minimum: 0 }),
		hasMore: Type.Boolean(),
	}, strict)),
	totalAvailable: Type.Integer({ minimum: 0 }),
}, strict);

const StructuralErrorSchema = Type.Object({
	path: Type.String(),
	code: Type.String(),
	message: Type.String(),
	candidates: Type.Optional(Type.Array(Type.String())),
}, strict);

export const GhApplyGraphOutputSchema = Type.Object({
	rolledBack: Type.Boolean(),
	timedOut: Type.Boolean(),
	counts: Type.Object({ components: Type.Integer(), widgets: Type.Integer(), scripts: Type.Integer(), wires: Type.Integer(), groups: Type.Integer() }, strict),
	refs: Type.Record(Type.String(), Type.String()),
	structuralErrors: Type.Array(StructuralErrorSchema),
	runtimeMessages: Type.Array(Type.Unknown()),
	overlaps: Type.Union([Type.Unknown(), Type.Null()]),
	elapsedMs: Type.Number({ minimum: 0 }),
}, strict);

export const RhQueryObjectsOutputSchema = Type.Object({
	objects: Type.Array(Type.Object({ objectId: Type.String(), name: Type.String(), layer: Type.String(), objectType: Type.String() }, strict)),
	total: Type.Integer({ minimum: 0 }),
	offset: Type.Integer({ minimum: 0 }),
	hasMore: Type.Boolean(),
	countOnly: Type.Boolean(),
}, strict);

export const RhRunScriptOutputSchema = Type.Object({
	items: Type.Array(Type.Object({
		index: Type.Integer({ minimum: 0 }),
		mode: Type.Union([Type.Literal("command"), Type.Literal("python"), Type.Literal("csharp")]),
		ok: Type.Boolean(),
		output: Type.String(),
		error: Type.Union([Type.String(), Type.Null()]),
	}, strict)),
}, strict);

export const OPERATION_SCHEMAS = {
	gh_get_canvas: { input: GhGetCanvasInputSchema, output: GhGetCanvasOutputSchema },
	gh_list_components: { input: GhListComponentsInputSchema, output: GhListComponentsOutputSchema },
	gh_apply_graph: { input: GhApplyGraphInputSchema, output: GhApplyGraphOutputSchema },
	rh_query_objects: { input: RhQueryObjectsInputSchema, output: RhQueryObjectsOutputSchema },
	rh_run_script: { input: RhRunScriptInputSchema, output: RhRunScriptOutputSchema },
} satisfies Record<string, { input: TSchema; output: TSchema }>;

export type GhGetCanvasInput = Static<typeof GhGetCanvasInputSchema>;
export type GhListComponentsInput = Static<typeof GhListComponentsInputSchema>;
export type RhQueryObjectsInput = Static<typeof RhQueryObjectsInputSchema>;
export type RhRunScriptInput = Static<typeof RhRunScriptInputSchema>;
