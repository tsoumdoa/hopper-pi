import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult, defaultProgressMsg } from "../edit-handlers.js";
import { resolveInstanceGuid, resolveTypeGuid } from "../../services/guid-shortener.js";
import { resolveComponentNumber } from "../../services/component-registry.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description:
		"Perform component operations on the Grasshopper canvas: add, delete, move, rename, set_locked, or set_hidden. Use gh_get_canvas first to get instance GUIDs for existing components. Use gh_list_components to find component numbers for adding new components. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("add"),
					Type.Literal("delete"),
					Type.Literal("move"),
					Type.Literal("rename"),
					Type.Literal("set_locked"),
					Type.Literal("set_hidden"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Component instance GUID (from gh_get_canvas) — required for delete/move/rename/set_locked/set_hidden" })
				),
				componentType: Type.Optional(
					Type.String({ description: "Component number (e.g. #3 or 3 from gh_list_components) or type GUID — required for add" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for add/move - must be greater than 20" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for add/move - must be greater than 20" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Nickname — optional for add, required for rename" })
				),
				preview: Type.Optional(
					Type.Boolean({ description: "Show geometry preview in Rhino viewport. Default is false — only set to true for Preview components." })
				),
				locked: Type.Optional(
					Type.Boolean({ description: "true to lock, false to unlock — required for set_locked" })
				),
				hidden: Type.Optional(
					Type.Boolean({ description: "set hidden by default except for Preview functions" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "add":
					return {
						action: "addComponent" as CommandAction,
						params: {
							typeGuid: resolveComponentNumber(item.componentType!) ?? resolveTypeGuid(item.componentType!),
							position: { x: item.x!, y: item.y! },
							nickName: item.nickName,
							preview: item.preview ?? false,
						},
					};
				case "delete":
					return { action: "deleteComponent", params: { targetId: resolveInstanceGuid(item.targetId!) } };
				case "move":
					return {
						action: "moveComponent",
						params: { targetId: resolveInstanceGuid(item.targetId!), position: { x: item.x!, y: item.y! } },
					};
				case "rename":
					return {
						action: "renameComponent",
						params: { targetId: resolveInstanceGuid(item.targetId!), nickName: item.nickName },
					};
				case "set_locked":
					return {
						action: "setComponentLocked",
						params: { targetId: resolveInstanceGuid(item.targetId!), locked: item.locked },
					};
				case "set_hidden":
					return {
						action: "setComponentHidden",
						params: { targetId: resolveInstanceGuid(item.targetId!), hidden: item.hidden },
					};
				default:
					return null;
			}
		},
		(item, result) => {
			if (item.action === "add") {
				return `${item.action} completed. type=${item.componentType}, jobId=${result.jobId}`;
			}
			return formatDefaultResult(item, result);
		},
		defaultProgressMsg,
	),
});