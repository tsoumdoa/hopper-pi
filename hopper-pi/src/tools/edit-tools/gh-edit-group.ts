import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditGroupTool = defineTool({
	name: "gh_edit_group",
	label: "Edit Group",
	description:
		"Perform group operations on Grasshopper canvas: add, remove from, delete, change color, rename, or change style (color/name/border). Accepts an array of operation items for batch processing. The 'border' field (Box/Blob/Rectangles) only applies to 'add' and 'changeStyle' operations.",
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
				componentIds: Type.Optional(
					Type.String({ description: "Comma-separated component IDs (for add/remove)" })
				),
				groupName: Type.Optional(
					Type.String({ description: "Name of the target group" })
				),
				color: Type.Optional(
					Type.String({ description: "Group color as rgba string (default rgba(255,255,255,150)) - alpha should always be 150 unless instructed otherwise. Used by add, changeColor, changeStyle" })
				),
				name: Type.Optional(
					Type.String({ description: "Name for the group (for add/rename) or new title (for changeStyle)" })
				),
				border: Type.Optional(
					Type.Union([
						Type.Literal("Box"),
						Type.Literal("Blob"),
						Type.Literal("Rectangles"),
					])
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.operation) {
				case "add":
					return {
						action: "addGroup",
						params: {
							componentIds: item.componentIds?.split(",")?.map((s) => s.trim()).map((s) => resolveInstanceGuid(s)),
							groupName: item.groupName,
							color: item.color ?? "rgba(255,255,255,150)",
							border: item.border,
						},
					};
				case "remove":
					return {
						action: "removeFromGroup",
						params: {
							componentIds: item.componentIds?.split(",")?.map((s) => s.trim()).map((s) => resolveInstanceGuid(s)),
							groupName: item.groupName,
						},
					};
				case "delete":
					return { action: "deleteGroup", params: { groupName: item.groupName } };
				case "changeColor":
					return { action: "changeGroupColor", params: { groupName: item.groupName, color: item.color ?? "rgba(255,255,255,150)" } };
				case "rename":
					return { action: "renameGroup", params: { groupName: item.groupName, name: item.name } };
				case "changeStyle":
					return { action: "changeGroupStyle", params: { groupName: item.groupName, color: item.color, name: item.name, border: item.border } };
				default:
					return null;
			}
		},
		(item, result) => {
			const rawIds = item.componentIds ?? "N/A";
			const resolved = rawIds === "N/A" ? "N/A" : rawIds.split(",").map((s) => resolveInstanceGuid(s.trim())).join(",");
			return `${item.operation} on "${item.groupName}". shortIds=${rawIds} -> resolvedGuids=[${resolved}], jobId=${result.jobId}`;
		},
		(item) => `${item.operation} on group "${item.groupName}"...`,
	),
});