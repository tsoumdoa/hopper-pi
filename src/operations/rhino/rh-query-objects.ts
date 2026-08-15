import { Type, type Static } from "@sinclair/typebox";
import { defineOperation } from "../../core/operations.js";
import { resolveRhinoGuid } from "../../services/guid-shortener.js";
import { preservePiSchemaJson } from "../edit/shared.js";
import { failed, succeeded } from "./shared.js";

const DEFAULT_LIMIT = 50;

const RhinoObjectTypeSchema = Type.Union(
	[
		Type.Literal("curve"),
		Type.Literal("point"),
		Type.Literal("brep"),
		Type.Literal("surface"),
		Type.Literal("mesh"),
	],
	{ description: "Rhino geometry kind" },
);

export const RhQueryObjectsInputSchema = preservePiSchemaJson(Type.Object({
	selectionOnly: Type.Optional(Type.Boolean({ description: "Only objects currently selected in Rhino" })),
	layer: Type.Optional(Type.String({ description: "Filter by layer name (exact match)" })),
	objectType: Type.Optional(RhinoObjectTypeSchema),
	objectIds: Type.Optional(Type.Array(
		Type.String({ description: "Rhino object ID (short or full)" }),
		{ minItems: 1, description: "Return only these Rhino object IDs" },
	)),
	countOnly: Type.Optional(Type.Boolean({ description: "Return match count only, no object list" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum results to return (1–100)" })),
	offset: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based pagination offset" })),
}));

const RhinoObjectInfoSchema = Type.Object({
	objectId: Type.String(),
	name: Type.String(),
	layer: Type.String(),
	objectType: Type.String(),
});

export const RhQueryObjectsOutputSchema = Type.Object({
	objects: Type.Array(RhinoObjectInfoSchema),
	total: Type.Integer({ minimum: 0 }),
});

export type RhQueryObjectsInput = Static<typeof RhQueryObjectsInputSchema>;
export type RhQueryObjectsData = Static<typeof RhQueryObjectsOutputSchema>;

type QueryResponse = {
	type?: string;
	timestamp?: number;
	objects?: RhQueryObjectsData["objects"];
	error?: string;
};

export const rhQueryObjectsOperation = defineOperation<RhQueryObjectsInput, RhQueryObjectsData>({
	name: "rh_query_objects",
	version: 1,
	description: "List or count Rhino document objects using selection, layer, type, and ID filters.",
	group: "rhino",
	possibleScopes: ["none"],
	inputSchema: RhQueryObjectsInputSchema,
	outputSchema: RhQueryObjectsOutputSchema,
	classifyScope: () => "none",
	summarizeInput: (input) => ({
		...(input.selectionOnly !== undefined ? { selectionOnly: input.selectionOnly } : {}),
		...(input.layer !== undefined ? { layer: input.layer } : {}),
		...(input.objectType !== undefined ? { objectType: input.objectType } : {}),
		...(input.objectIds !== undefined ? { objectIds: input.objectIds } : {}),
		...(input.countOnly !== undefined ? { countOnly: input.countOnly } : {}),
		...(input.limit !== undefined ? { limit: input.limit } : {}),
		...(input.offset !== undefined ? { offset: input.offset } : {}),
	}),
	async execute(input, context) {
		const response = await context.backend.query<QueryResponse>({
			type: "queryRhinoObjects",
			...(input.selectionOnly !== undefined ? { selectionOnly: input.selectionOnly } : {}),
			...(input.layer !== undefined ? { layer: input.layer } : {}),
			...(input.objectType !== undefined ? { objectType: input.objectType } : {}),
			...(input.objectIds !== undefined ? { objectIds: input.objectIds.map(resolveRhinoGuid) } : {}),
		}, context.signal);
		if (response.error) return failed("operation_failed", response.error);

		const all = response.objects ?? [];
		if (input.countOnly) {
			return succeeded(`${all.length} Rhino object(s) matched.`, { objects: [], total: all.length });
		}
		const offset = input.offset ?? 0;
		const objects = all.slice(offset, offset + (input.limit ?? DEFAULT_LIMIT));
		return succeeded(`${all.length} Rhino object(s) matched.`, { objects, total: all.length });
	},
});
