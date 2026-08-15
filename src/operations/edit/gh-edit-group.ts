import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	ItemOperationDataSchema,
	commandAction,
	executePreparedItemMutation,
	preservePiSchemaJson,
	preparedItemMutation,
} from "./shared.js";

const BorderType = Type.Union([
	Type.Literal("Box"),
	Type.Literal("Blob"),
	Type.Literal("Rectangles"),
]);
const ComponentIds = Type.Array(Type.String(), {
	minItems: 1,
	description: "Component instance GUIDs from gh_get_canvas",
});

export const GhEditGroupInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Object({
			operation: Type.Literal("add"),
			componentIds: ComponentIds,
			groupName: Type.String({ description: "New or existing group name" }),
			color: Type.Optional(Type.String({ description: "RGBA, e.g. rgba(255,255,255,150)" })),
			border: Type.Optional(BorderType),
		}),
		Type.Object({
			operation: Type.Literal("remove"),
			componentIds: ComponentIds,
			groupName: Type.String({ description: "Target group name" }),
		}),
		Type.Object({ operation: Type.Literal("delete"), groupName: Type.String({ description: "Target group name" }) }),
		Type.Object({
			operation: Type.Literal("changeColor"),
			groupName: Type.String({ description: "Target group name" }),
			color: Type.String({ description: "RGBA, e.g. rgba(255,255,255,150)" }),
		}),
		Type.Object({
			operation: Type.Literal("rename"),
			groupName: Type.String({ description: "Current group name" }),
			name: Type.String({ description: "New group name" }),
		}),
		Type.Object({
			operation: Type.Literal("changeStyle"),
			groupName: Type.String({ description: "Target group name" }),
			border: BorderType,
			color: Type.Optional(Type.String({ description: "Optional RGBA colour update" })),
			name: Type.Optional(Type.String({ description: "Optional group rename" })),
		}),
	]), { minItems: 1 }),
}));

export type GhEditGroupInput = Static<typeof GhEditGroupInputSchema> & JsonValue;

const commandNames = {
	add: "addGroup",
	remove: "removeFromGroup",
	delete: "deleteGroup",
	changeColor: "changeGroupColor",
	rename: "renameGroup",
	changeStyle: "changeGroupStyle",
} as const;

function resolvedIds(ids: readonly string[]): string[] {
	return ids.map((id) => resolveInstanceGuid(id.trim()));
}

async function prepareMutation(input: GhEditGroupInput) {
	const descriptors = input.items.map((item) => ({ action: commandNames[item.operation] }));
	const actions = input.items.map((item) => {
		switch (item.operation) {
			case "add":
				return commandAction("addGroup", {
					componentIds: resolvedIds(item.componentIds),
					groupName: item.groupName,
					color: item.color ?? "rgba(255,255,255,150)",
					...(item.border === undefined ? {} : { border: item.border }),
				});
			case "remove":
				return commandAction("removeFromGroup", {
					componentIds: resolvedIds(item.componentIds),
					groupName: item.groupName,
				});
			case "delete":
				return commandAction("deleteGroup", { groupName: item.groupName });
			case "changeColor":
				return commandAction("changeGroupColor", { groupName: item.groupName, color: item.color });
			case "rename":
				return commandAction("renameGroup", { groupName: item.groupName, name: item.name });
			case "changeStyle":
				return commandAction("changeGroupStyle", {
					groupName: item.groupName,
					...(item.color === undefined ? {} : { color: item.color }),
					...(item.name === undefined ? {} : { name: item.name }),
					border: item.border,
				});
		}
	});
	return preparedItemMutation(actions, descriptors);
}

export const ghEditGroupOperation = defineOperation({
	name: "gh_edit_group",
	version: 1,
	description: "Create and edit Grasshopper groups.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: GhEditGroupInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: () => "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	execute: (input, context) => executePreparedItemMutation(prepareMutation, input, context),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			operation: item.operation,
			groupName: item.groupName,
			...("componentIds" in item ? { componentCount: item.componentIds.length } : {}),
		})),
	}),
});
