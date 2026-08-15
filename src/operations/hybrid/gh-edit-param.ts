import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import { ItemOperationDataSchema, preservePiSchemaJson, type ItemOperationData } from "../edit/shared.js";
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

const DataMappingType = Type.Union([
	Type.Literal("none"), Type.Literal("flatten"), Type.Literal("graft"),
], { description: "Data mapping mode" });
const AccessType = Type.Union([
	Type.Literal("item"), Type.Literal("list"), Type.Literal("tree"),
], { description: "Access type (default: item)" });
const TypeHintType = Type.Union([
	Type.Literal("object"), Type.Literal("double"), Type.Literal("int"), Type.Literal("integer"),
	Type.Literal("string"), Type.Literal("bool"), Type.Literal("boolean"),
], {
	description: "Script param type hint (default: object). Use double for floating-point numbers, int for integers, string for text, bool for booleans.",
});
const ScriptIOFields = Type.Object({
	name: Type.String({ description: "Parameter name" }),
	previousName: Type.Optional(Type.String({
		description: "Old port name when renaming (preserves wires). Use when order changes or swapping names.",
	})),
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean({ description: "Simplify data paths" })),
	reverse: Type.Optional(Type.Boolean({ description: "Reverse item order" })),
});
const EditableFields = {
	targetId: Type.String({ description: "Component GUID" }),
	name: Type.String({ description: "Parameter name" }),
};
const PortProperties = {
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean({ description: "Simplify data paths" })),
	reverse: Type.Optional(Type.Boolean({ description: "Reverse item order" })),
};

export const GhEditParamInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Object({
			action: Type.Literal("syncParams"),
			targetId: Type.String({ description: "Script component GUID" }),
			inputs: Type.Optional(Type.Array(ScriptIOFields, {
				description: "Full desired inputs — updates in place, adds missing, removes extras. Omit (undefined) to leave unchanged; [] removes all inputs.",
			})),
			outputs: Type.Optional(Type.Array(ScriptIOFields, {
				description: "Full desired outputs. Omit to leave unchanged; [] removes all outputs.",
			})),
		}),
		Type.Object({
			action: Type.Literal("listParams"),
			targetId: Type.String({ description: "Component GUID" }),
		}),
		Type.Object({ action: Type.Literal("removeInput"), ...EditableFields }),
		Type.Object({ action: Type.Literal("removeOutput"), ...EditableFields }),
		Type.Object({ action: Type.Literal("addInput"), ...EditableFields, ...PortProperties }),
		Type.Object({
			action: Type.Literal("addOutput"),
			...EditableFields,
			typeHint: Type.Optional(TypeHintType),
			dataMapping: Type.Optional(DataMappingType),
			simplify: Type.Optional(Type.Boolean({ description: "Simplify data paths" })),
			reverse: Type.Optional(Type.Boolean({ description: "Reverse item order" })),
		}),
		Type.Object({ action: Type.Literal("editAccessType"), ...EditableFields, ...PortProperties }),
	]), { minItems: 1 }),
}));

export type GhEditParamInput = Static<typeof GhEditParamInputSchema> & JsonValue;

function withDefined(values: Record<string, JsonValue | undefined>): JsonObject {
	return Object.fromEntries(
		Object.entries(values).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
	);
}

function planMutations(input: GhEditParamInput): PlannedMutation[] {
	return input.items.flatMap((item, index) => {
		if (item.action === "listParams") return [];
		const targetId = resolveInstanceGuid(item.targetId);
		let command: string;
		let params: JsonObject;
		switch (item.action) {
			case "syncParams":
				command = "syncScriptParams";
				params = withDefined({ targetId, inputs: item.inputs, outputs: item.outputs });
				break;
			case "addInput":
				command = "addScriptInput";
				params = withDefined({ targetId, name: item.name, typeHint: item.typeHint, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse });
				break;
			case "removeInput":
				command = "removeScriptInput";
				params = { targetId, name: item.name };
				break;
			case "addOutput":
				command = "addScriptOutput";
				params = withDefined({ targetId, name: item.name, typeHint: item.typeHint, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse });
				break;
			case "removeOutput":
				command = "removeScriptOutput";
				params = { targetId, name: item.name };
				break;
			case "editAccessType":
				command = "editParamProps";
				params = withDefined({ targetId, name: item.name, typeHint: item.typeHint, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse });
				break;
		}
		return [commandMutation(index, item.action, command, params, item.targetId)];
	});
}

async function prepareMutation(input: GhEditParamInput) {
	if (input.items.length === 0) rejectEmptyItems("gh_edit_param");
	if (input.items.some((item) => item.action === "listParams")) rejectReadItems("gh_edit_param");
	return preparedHybridMutation(planMutations(input));
}

type ListParamsResponse = {
	inputs?: JsonValue[];
	outputs?: JsonValue[];
	error?: string;
};

export const ghEditParamOperation = defineOperation<GhEditParamInput, ItemOperationData>({
	name: "gh_edit_param",
	version: 1,
	description: "Inspect or edit ports on Grasshopper C# and Python script components.",
	group: "gh-script",
	possibleScopes: ["none", "grasshopper"],
	inputSchema: GhEditParamInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: (input) => input.items.every((item) => item.action === "listParams") ? "none" : "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			action: item.action,
			targetId: item.targetId,
			...("name" in item ? { name: item.name } : {}),
			...(item.action === "syncParams" ? {
				inputCount: item.inputs?.length ?? null,
				outputCount: item.outputs?.length ?? null,
			} : {}),
		})),
	}),
	async execute(input, context) {
		const reads = input.items.flatMap((item, index) => item.action === "listParams" ? [{
			originalIndex: index,
			publicAction: item.action,
			targetId: item.targetId,
			async execute() {
				try {
					const response = await context.backend.query<ListParamsResponse>({
						type: "listScriptParams",
						targetId: resolveInstanceGuid(item.targetId),
					}, context.signal);
					if (response.error) throw new Error(response.error);
					const data = { inputs: response.inputs ?? [], outputs: response.outputs ?? [] };
					return readItemResult(index, item.action, item.targetId, data, "Listed script parameters.");
				} catch (error) {
					return failedReadItem(index, item.action, item.targetId, error);
				}
			},
		}] : []);
		return executeHybridInOrder(context, input.items.length, reads, planMutations(input));
	},
});
