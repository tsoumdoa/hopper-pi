import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";

const BorderType = Type.Union([
	Type.Literal("Box"),
	Type.Literal("Blob"),
	Type.Literal("Rectangles"),
]);

const ComponentIds = Type.Array(Type.String(), {
	minItems: 1,
});

function resolvedIds(ids: readonly string[]): string[] {
	return ids.map((id) => resolveInstanceGuid(id.trim()));
}

/** Compatibility for tool calls stored before componentIds became an array. */
export function normalizeGroupArguments(args: unknown): any {
	if (!args || typeof args !== "object") return args;
	const input = args as { items?: Array<Record<string, unknown>> };
	if (!Array.isArray(input.items)) return args;

	return {
		...input,
		items: input.items.map((item) => ({
			...item,
			componentIds: typeof item.componentIds === "string"
				? item.componentIds.split(",").map((id) => id.trim()).filter(Boolean)
				: item.componentIds,
		})),
	};
}

export const ghEditGroupTool = defineTool({
	name: "gh_edit_group",
	label: "Edit Group",
	description: "Surgically create or edit Grasshopper groups using existing object IDs and group names.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				operation: Type.Union([
					Type.Literal("add"),
					Type.Literal("remove"),
					Type.Literal("delete"),
					Type.Literal("changeColor"),
					Type.Literal("rename"),
					Type.Literal("changeStyle"),
				]),
				groupName: Type.String(),
				componentIds: Type.Optional(ComponentIds),
				color: Type.Optional(Type.String()),
				border: Type.Optional(BorderType),
				name: Type.Optional(Type.String()),
			}),
			{ minItems: 1 },
		),
	}),
	prepareArguments: normalizeGroupArguments,
	execute: createExecute(
		(item) => {
			const required: Record<string, string[]> = {
				add: ["componentIds"],
				remove: ["componentIds"],
				delete: [],
				changeColor: ["color"],
				rename: ["name"],
				changeStyle: ["border"],
			};
			const missing = required[item.operation].filter(
				(field) => (item as Record<string, unknown>)[field] == null,
			);
			if (missing.length > 0) throw new Error(`${item.operation} requires ${missing.join(", ")}`);
			switch (item.operation) {
				case "add":
					return {
						action: "addGroup",
						params: {
							componentIds: resolvedIds(item.componentIds!),
							groupName: item.groupName,
							color: item.color ?? "rgba(255,255,255,150)",
							border: item.border,
						},
					};
				case "remove":
					return {
						action: "removeFromGroup",
						params: {
							componentIds: resolvedIds(item.componentIds!),
							groupName: item.groupName,
						},
					};
				case "delete":
					return { action: "deleteGroup", params: { groupName: item.groupName } };
				case "changeColor":
					return { action: "changeGroupColor", params: { groupName: item.groupName, color: item.color } };
				case "rename":
					return { action: "renameGroup", params: { groupName: item.groupName, name: item.name } };
				case "changeStyle":
					return {
						action: "changeGroupStyle",
						params: { groupName: item.groupName, color: item.color, name: item.name, border: item.border },
					};
			}
		},
		(item) => `${item.operation} on group "${item.groupName}"...`,
	),
});
