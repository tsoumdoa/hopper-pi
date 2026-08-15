import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { MAX_RHINO_OBJECT_IDS } from "../../config.js";
import {
	resolveInstanceGuid,
	resolveRhinoGuids,
	toShortInstanceGuid,
	toShortRhinoGuid,
} from "../../services/guid-shortener.js";
import { preservePiSchemaJson, ItemOperationDataSchema, type ItemOperationData } from "../edit/shared.js";
import {
	commandMutation,
	executeHybridInOrder,
	failedReadItem,
	preparedHybridMutation,
	readItemResult,
	rejectEmptyItems,
	rejectReadItems,
	type PlannedMutation,
} from "./shared.js";

const RhinoObjectTypeSchema = Type.Union([
	Type.Literal("curve"), Type.Literal("point"), Type.Literal("brep"),
	Type.Literal("surface"), Type.Literal("mesh"),
], { description: "Rhino geometry kind" });

const RhinoQuerySchema = Type.Union([
	Type.Object({
		selectionOnly: Type.Literal(true, { description: "Only objects currently selected in Rhino" }),
		layer: Type.Optional(Type.String({ minLength: 1, description: "Exact layer name" })),
		objectType: Type.Optional(RhinoObjectTypeSchema),
	}, { additionalProperties: false }),
	Type.Object({
		layer: Type.String({ minLength: 1, description: "Exact layer name" }),
		selectionOnly: Type.Optional(Type.Boolean()),
		objectType: Type.Optional(RhinoObjectTypeSchema),
	}, { additionalProperties: false }),
	Type.Object({
		objectType: RhinoObjectTypeSchema,
		selectionOnly: Type.Optional(Type.Boolean()),
		layer: Type.Optional(Type.String({ minLength: 1, description: "Exact layer name" })),
	}, { additionalProperties: false }),
], { description: "Filtered Rhino query; requires layer, objectType, or selectionOnly: true." });

const IdSource = (action: "reference" | "internalize") => Type.Object({
	action: Type.Literal(action),
	targetId: Type.String({ description: "Geometry param instance GUID (short or full)" }),
	rhinoObjectIds: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_RHINO_OBJECT_IDS,
		description: `Rhino object IDs (short or full), max ${MAX_RHINO_OBJECT_IDS}`,
	}),
}, { additionalProperties: false });

const QuerySource = (action: "reference" | "internalize") => Type.Object({
	action: Type.Literal(action),
	targetId: Type.String({ description: "Geometry param instance GUID (short or full)" }),
	rhinoQuery: RhinoQuerySchema,
}, { additionalProperties: false });

export const GhParamRhinoInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Object({
			action: Type.Literal("get"),
			targetId: Type.String({ description: "Geometry param instance GUID (short or full)" }),
		}, { additionalProperties: false }),
		IdSource("reference"),
		QuerySource("reference"),
		IdSource("internalize"),
		QuerySource("internalize"),
	]), { minItems: 1 }),
}));

export type GhParamRhinoInput = Static<typeof GhParamRhinoInputSchema> & JsonValue;

type ParamGeometryItem = {
	path: string;
	gooType: string;
	rhinoObjectId: string;
	source: string;
};

type GetResponse = {
	targetId: string;
	paramName: string;
	volatileItems: ParamGeometryItem[];
	persistentItems: ParamGeometryItem[];
	error?: string;
};

function planMutations(input: GhParamRhinoInput): PlannedMutation[] {
	return input.items.flatMap((item, index) => {
		if (item.action === "get") return [];
		const params: JsonObject = {
			targetId: resolveInstanceGuid(item.targetId),
			mode: item.action,
			...("rhinoObjectIds" in item
				? { rhinoObjectIds: resolveRhinoGuids(item.rhinoObjectIds) }
				: { rhinoQuery: item.rhinoQuery }),
		};
		return [commandMutation(
			index,
			item.action,
			"setParamRhinoGeometry",
			params,
			item.targetId,
		)];
	});
}

async function prepareMutation(input: GhParamRhinoInput) {
	if (input.items.length === 0) rejectEmptyItems("gh_param_rhino");
	if (input.items.some((item) => item.action === "get")) rejectReadItems("gh_param_rhino");
	return preparedHybridMutation(planMutations(input));
}

function summarizeSource(item: Exclude<GhParamRhinoInput["items"][number], { action: "get" }>): JsonObject {
	if ("rhinoObjectIds" in item) {
		return { kind: "ids", count: item.rhinoObjectIds.length };
	}
	return {
		kind: "query",
		selectionOnly: item.rhinoQuery.selectionOnly ?? false,
		...(item.rhinoQuery.layer ? { layer: item.rhinoQuery.layer } : {}),
		...(item.rhinoQuery.objectType ? { objectType: item.rhinoQuery.objectType } : {}),
	};
}

export const ghParamRhinoOperation = defineOperation<GhParamRhinoInput, ItemOperationData>({
	name: "gh_param_rhino",
	version: 1,
	description: "Get, reference, or internalize Rhino geometry on a Grasshopper geometry parameter.",
	group: "gh-edit",
	possibleScopes: ["none", "grasshopper"],
	inputSchema: GhParamRhinoInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: (input) => input.items.every((item) => item.action === "get") ? "none" : "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			action: item.action,
			targetId: item.targetId,
			...(item.action === "get" ? {} : { source: summarizeSource(item) }),
		})),
	}),
	async execute(input, context) {
		const reads = input.items.flatMap((item, index) => item.action === "get" ? [{
			originalIndex: index,
			publicAction: item.action,
			targetId: item.targetId,
			async execute() {
				try {
					const response = await context.backend.query<GetResponse>({
						type: "getParamRhinoGeometry",
						targetId: resolveInstanceGuid(item.targetId),
					}, context.signal);
					if (response.error) throw new Error(response.error);
					const data = {
						paramName: response.paramName,
						targetId: toShortInstanceGuid(response.targetId),
						volatileItems: response.volatileItems.map((entry) => ({
							...entry,
							rhinoObjectId: entry.rhinoObjectId ? toShortRhinoGuid(entry.rhinoObjectId) : "",
						})),
						persistentItems: response.persistentItems.map((entry) => ({
							...entry,
							rhinoObjectId: entry.rhinoObjectId ? toShortRhinoGuid(entry.rhinoObjectId) : "",
						})),
					};
					return readItemResult(index, item.action, item.targetId, data, `Read parameter ${data.paramName}.`);
				} catch (error) {
					return failedReadItem(index, item.action, item.targetId, error);
				}
			},
		}] : []);
		return executeHybridInOrder(context, input.items.length, reads, planMutations(input));
	},
});
