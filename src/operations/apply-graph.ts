import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type {
	ExecuteActionsResponse,
	JsonObject,
	JsonSchema,
	OperationResult,
} from "../core/contracts.js";
import {
	defineOperation,
	type OperationContext,
	type PreparedMutation,
} from "../core/operations.js";
import type { CanvasOverlapResult } from "../tools/canvas-checks.js";
import type { ApplyGraphInput } from "../types/gh-apply-graph.js";
import type { CanvasError } from "../types/messages.js";

export type ApplyGraphData = {
	counts: {
		components: number;
		widgets: number;
		scripts: number;
		wires: number;
		groups: number;
	};
	refs: Record<string, string>;
	runtimeMessages: CanvasError[];
	overlaps: CanvasOverlapResult | null;
};

const Ref = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" });
const Coordinate = Type.Number({ minimum: 20 });
const Name = Type.Optional(Type.String());
const Port = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);
// Type.Tuple emits draft-07 items/additionalItems. The public schema uses the
// draft 2020-12 tuple form accepted by Anthropic and other strict consumers.
const Endpoint = Type.Unsafe({
	type: "array",
	prefixItems: [Ref, Port],
	items: false,
	minItems: 2,
	maxItems: 2,
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

const Slider = Type.Object({
	...Position,
	kind: Type.Literal("slider"),
	min: Type.Number(),
	max: Type.Number(),
	value: Type.Number(),
	digits: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
});
const PanelTextOutput = Type.Union([
	Type.Literal("singleString"),
	Type.Literal("oneItemPerLine"),
], {
	description:
		"How panel text becomes downstream data. singleString: entire text is one string (newlines preserved). oneItemPerLine: each line is a separate list item.",
});
const Panel = Type.Object({
	...Position,
	kind: Type.Literal("panel"),
	text: Type.String(),
	textOutput: Type.Optional(PanelTextOutput),
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

const DataMapping = Type.Union([
	Type.Literal("none"),
	Type.Literal("flatten"),
	Type.Literal("graft"),
], { description: "Data mapping mode" });
const Access = Type.Union([
	Type.Literal("item"),
	Type.Literal("list"),
	Type.Literal("tree"),
], { description: "Access type (default: item)" });
const TypeHint = Type.Union([
	Type.Literal("object"),
	Type.Literal("double"),
	Type.Literal("int"),
	Type.Literal("integer"),
	Type.Literal("string"),
	Type.Literal("bool"),
	Type.Literal("boolean"),
], {
	description:
		"Script param type hint (default: object). Use double for floating-point numbers, int for integers, string for text, bool for booleans.",
});
const ScriptParts = Type.Object({
	references: Type.Optional(Type.Array(Type.String())),
	runScript: Type.String(),
	helpers: Type.Optional(Type.String()),
});
const ScriptPort = Type.Object({
	name: Type.String(),
	previousName: Type.Optional(Type.String()),
	typeHint: Type.Optional(TypeHint),
	access: Type.Optional(Access),
	dataMapping: Type.Optional(DataMapping),
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

function preserveLegacySchemaKeyOrder<T extends object>(schema: T): T {
	for (const value of Object.values(schema)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") preserveLegacySchemaKeyOrder(item);
			}
		} else if (value && typeof value === "object") {
			preserveLegacySchemaKeyOrder(value);
		}
	}

	const record = schema as Record<string, unknown>;
	if (typeof record.type !== "string" && !Array.isArray(record.anyOf)) return schema;
	const preferred = Array.isArray(record.anyOf)
		? ["anyOf", "description"]
		: record.type === "object"
			? ["type", "required", "properties"]
			: record.type === "array"
				? ["type", "prefixItems", "items", "minItems", "maxItems"]
				: ["type", "const", "pattern", "minimum", "maximum", "minLength", "maxLength", "description"];
	const keys = Object.keys(record);
	const orderedKeys = [
		...preferred.filter((key) => keys.includes(key)),
		...keys.filter((key) => !preferred.includes(key)),
	];
	const entries = orderedKeys.map((key) => [key, record[key]] as const);
	for (const key of keys) delete record[key];
	for (const [key, value] of entries) record[key] = value;
	return schema;
}

export const ApplyGraphInputSchema = preserveLegacySchemaKeyOrder(Type.Object({
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
})) as JsonSchema<ApplyGraphInput>;

const CountsSchema = Type.Object({
	components: Type.Integer({ minimum: 0 }),
	widgets: Type.Integer({ minimum: 0 }),
	scripts: Type.Integer({ minimum: 0 }),
	wires: Type.Integer({ minimum: 0 }),
	groups: Type.Integer({ minimum: 0 }),
});
const CanvasErrorSchema = Type.Object({
	componentId: Type.String(),
	componentNickName: Type.String(),
	level: Type.Union([
		Type.Literal("error"),
		Type.Literal("warning"),
		Type.Literal("message"),
		Type.Literal("unknown"),
	]),
	text: Type.String(),
});
const OverlapSchema = Type.Object({
	componentA: Type.String(),
	nickNameA: Type.String(),
	componentB: Type.String(),
	nickNameB: Type.String(),
	intersectionArea: Type.Number({ minimum: 0 }),
});
const CanvasOverlapSchema = Type.Object({
	hasOverlaps: Type.Boolean(),
	componentOverlaps: Type.Array(OverlapSchema),
	groupOverlaps: Type.Array(OverlapSchema),
});

export const ApplyGraphOutputSchema = Type.Object({
	counts: CountsSchema,
	refs: Type.Record(Type.String(), Type.String()),
	runtimeMessages: Type.Array(CanvasErrorSchema),
	overlaps: Type.Union([CanvasOverlapSchema, Type.Null()]),
}) as JsonSchema<ApplyGraphData>;

type TextDigest = {
	sha256: string;
	byteLength: number;
	lineCount: number;
};

function summarizeText(text: string): TextDigest {
	return {
		sha256: createHash("sha256").update(text, "utf8").digest("hex"),
		byteLength: Buffer.byteLength(text, "utf8"),
		lineCount: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
	};
}

export function summarizeApplyGraphInput(input: ApplyGraphInput): JsonObject {
	return {
		counts: {
			components: input.components?.length ?? 0,
			widgets: input.widgets?.length ?? 0,
			scripts: input.scripts?.length ?? 0,
			wires: input.wires?.length ?? 0,
			groups: input.groups?.length ?? 0,
		},
		scripts: (input.scripts ?? []).map((script) => ({
			ref: script.ref,
			language: script.language,
			...(script.code === undefined ? {} : { source: summarizeText(script.code) }),
			...(script.scriptParts === undefined
				? {}
				: {
					scriptParts: {
						references: summarizeText((script.scriptParts.references ?? []).join("\n")),
						runScript: summarizeText(script.scriptParts.runScript),
						helpers: summarizeText(script.scriptParts.helpers ?? ""),
					},
				}),
		})),
	};
}

function resultMessage(response: ExecuteActionsResponse): string {
	if (response.outcome === "succeeded") return "Applied the Grasshopper graph.";
	return response.error?.message ?? `Grasshopper graph apply ended with outcome ${response.outcome}.`;
}

function finishApplyGraph(response: ExecuteActionsResponse): OperationResult<ApplyGraphData> {
	const fallbackError = response.outcome === "succeeded" || response.outcome === "in_progress"
		? null
		: {
			code: response.outcome === "unknown"
				? "outcome_unknown" as const
				: response.outcome === "partial"
					? "partial_mutation" as const
					: "operation_failed" as const,
			message: `Grasshopper graph apply ended with outcome ${response.outcome}.`,
			retryable: response.outcome === "unknown",
		};
	const envelope = response.data && typeof response.data === "object" && !Array.isArray(response.data)
		? response.data
		: null;
	const firstAction = envelope && Array.isArray(envelope.actions)
		? envelope.actions[0]
		: null;
	const actionData = firstAction && typeof firstAction === "object" && !Array.isArray(firstAction)
		? firstAction.data
		: null;
	const directData = envelope && "counts" in envelope && "refs" in envelope
		? envelope
		: null;
	return {
		outcome: response.outcome,
		message: resultMessage(response),
		data: (actionData ?? directData) as ApplyGraphData | null,
		execution: { canvasDigestAfter: response.canvasDigestAfter ?? null },
		warnings: [],
		artifacts: [],
		error: response.error ?? fallbackError,
	};
}

export async function prepareApplyGraphMutation(
	input: ApplyGraphInput,
	_context: OperationContext,
): Promise<PreparedMutation<ApplyGraphData>> {
	return {
		scope: "grasshopper",
		actions: [{ kind: "applyGraph", input }],
		finish: finishApplyGraph,
	};
}

export const ghApplyGraphOperation = defineOperation<ApplyGraphInput, ApplyGraphData>({
	name: "gh_apply_graph",
	version: 1,
	description:
		"Atomically create a new Grasshopper subgraph with local refs, validation, and one backend transaction.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: ApplyGraphInputSchema,
	outputSchema: ApplyGraphOutputSchema,
	classifyScope: () => "grasshopper",
	summarizeInput: summarizeApplyGraphInput,
	prepareMutation: prepareApplyGraphMutation,
	async execute(input, context) {
		context.reportProgress({ phase: "execute", message: "Applying Grasshopper graph." });
		const prepared = await prepareApplyGraphMutation(input, context);
		const response = await context.backend.executeActions({
			scope: prepared.scope,
			actions: prepared.actions,
		}, context.signal);
		return prepared.finish(response);
	},
});
