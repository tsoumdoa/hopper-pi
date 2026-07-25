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
	description: "Component instance GUIDs from gh_get_canvas",
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
	description:
		"Create groups, add/remove members, or delete, rename, recolour, and restyle existing Grasshopper groups. " +
		"Use component instance GUIDs from gh_get_canvas; groupName identifies the target group.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
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
				Type.Object({
					operation: Type.Literal("delete"),
					groupName: Type.String({ description: "Target group name" }),
				}),
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
			]),
			{ minItems: 1 },
		),
	}),
	prepareArguments: normalizeGroupArguments,
	execute: createExecute(
		(item) => {
			switch (item.operation) {
				case "add":
					return {
						action: "addGroup",
						params: {
							componentIds: resolvedIds(item.componentIds),
							groupName: item.groupName,
							color: item.color ?? "rgba(255,255,255,150)",
							border: item.border,
						},
					};
				case "remove":
					return {
						action: "removeFromGroup",
						params: {
							componentIds: resolvedIds(item.componentIds),
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
		(item, result) => {
			const ids = "componentIds" in item ? item.componentIds.join(",") : "N/A";
			return `${item.operation} on "${item.groupName}". ids=[${ids}], jobId=${result.jobId}`;
		},
		(item) => `${item.operation} on group "${item.groupName}"...`,
	),
});
