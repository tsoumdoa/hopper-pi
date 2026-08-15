import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { resolveInstanceGuid, resolveTypeGuid } from "../../services/guid-shortener.js";
import {
	ItemOperationDataSchema,
	commandAction,
	executePreparedItemMutation,
	preservePiSchemaJson,
	preparedItemMutation,
} from "./shared.js";

export const GhEditComponentsInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Object({
			action: Type.Literal("add"),
			componentType: Type.String({ description: "Type GUID for add action (from gh_list_components)" }),
			x: Type.Number({ description: "Canvas X (must be > 20)" }),
			y: Type.Number({ description: "Canvas Y (must be > 20)" }),
			nickName: Type.Optional(Type.String({ description: "Display nickname" })),
			preview: Type.Optional(Type.Boolean({ description: "Show geometry preview (default false)" })),
		}),
		Type.Object({ action: Type.Literal("delete"), targetId: Type.String({ description: "Component GUID" }) }),
		Type.Object({
			action: Type.Literal("move"),
			targetId: Type.String({ description: "Component GUID" }),
			x: Type.Number({ description: "Canvas X (must be > 20)" }),
			y: Type.Number({ description: "Canvas Y (must be > 20)" }),
		}),
		Type.Object({
			action: Type.Literal("rename"),
			targetId: Type.String({ description: "Component GUID" }),
			nickName: Type.String({ description: "Display nickname" }),
		}),
		Type.Object({
			action: Type.Literal("set_locked"),
			targetId: Type.String({ description: "Component GUID" }),
			locked: Type.Boolean({ description: "Lock state" }),
		}),
		Type.Object({
			action: Type.Literal("set_hidden"),
			targetId: Type.String({ description: "Component GUID" }),
			hidden: Type.Boolean({ description: "Visibility state" }),
		}),
	]), { minItems: 1 }),
}));

export type GhEditComponentsInput = Static<typeof GhEditComponentsInputSchema> & JsonValue;

const commandNames = {
	add: "addComponent",
	delete: "deleteComponent",
	move: "moveComponent",
	rename: "renameComponent",
	set_locked: "setComponentLocked",
	set_hidden: "setComponentHidden",
} as const;

async function prepareMutation(input: GhEditComponentsInput) {
	const descriptors = input.items.map((item) => ({
		action: commandNames[item.action],
		...(item.action === "add" ? {} : { targetId: item.targetId }),
	}));
	const actions = input.items.map((item) => {
		switch (item.action) {
			case "add":
				return commandAction("addComponent", {
					typeGuid: resolveTypeGuid(item.componentType),
					position: { x: item.x, y: item.y },
					...(item.nickName === undefined ? {} : { nickName: item.nickName }),
					preview: item.preview ?? false,
				});
			case "delete":
				return commandAction("deleteComponent", { targetId: resolveInstanceGuid(item.targetId) });
			case "move":
				return commandAction("moveComponent", {
					targetId: resolveInstanceGuid(item.targetId),
					position: { x: item.x, y: item.y },
				});
			case "rename":
				return commandAction("renameComponent", {
					targetId: resolveInstanceGuid(item.targetId),
					nickName: item.nickName,
				});
			case "set_locked":
				return commandAction("setComponentLocked", {
					targetId: resolveInstanceGuid(item.targetId),
					locked: item.locked,
				});
			case "set_hidden":
				return commandAction("setComponentHidden", {
					targetId: resolveInstanceGuid(item.targetId),
					hidden: item.hidden,
				});
		}
	});
	return preparedItemMutation(actions, descriptors);
}

export const ghEditComponentsOperation = defineOperation({
	name: "gh_edit_components",
	version: 1,
	description: "Add, delete, move, rename, lock, or hide Grasshopper canvas objects.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: GhEditComponentsInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: () => "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	execute: (input, context) => executePreparedItemMutation(prepareMutation, input, context),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			action: item.action,
			...(item.action === "add"
				? { componentType: item.componentType, position: { x: item.x, y: item.y }, hasNickName: item.nickName !== undefined }
				: { targetId: item.targetId }),
		})),
	}),
});
