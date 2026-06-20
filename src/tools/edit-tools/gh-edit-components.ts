import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../execute-factory.js";
import { formatDefaultResult, defaultProgressMsg } from "../result-formatters.js";
import { resolveInstanceGuid, resolveTypeGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description:
		"add, delete, move, rename, lock, or hide components.",
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
					Type.String({ description: "Component GUID" })
				),
				componentType: Type.Optional(
					Type.String({ description: "Type GUID for add action (from gh_list_components)" })
				),
				x: Type.Optional(
					Type.Number({ description: "Canvas X (must be > 20)" })
				),
				y: Type.Optional(
					Type.Number({ description: "Canvas Y (must be > 20)" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Display nickname" })
				),
				preview: Type.Optional(
					Type.Boolean({ description: "Show geometry preview (default false)" })
				),
				locked: Type.Optional(
					Type.Boolean({ description: "Lock state" })
				),
				hidden: Type.Optional(
					Type.Boolean({ description: "Visibility state" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "add": {
					if (!item.componentType) {
						throw new Error("add action requires componentType");
					}
					if (item.x === undefined || item.y === undefined) {
						throw new Error("add action requires x and y");
					}
					return {
						action: "addComponent" as CommandAction,
						params: {
							typeGuid: resolveTypeGuid(item.componentType),
							position: { x: item.x, y: item.y },
							nickName: item.nickName,
							preview: item.preview ?? false,
						},
					};
				}
				case "delete": {
					if (!item.targetId) {
						throw new Error("delete action requires targetId");
					}
					return { action: "deleteComponent", params: { targetId: resolveInstanceGuid(item.targetId) } };
				}
				case "move": {
					if (!item.targetId) {
						throw new Error("move action requires targetId");
					}
					if (item.x === undefined || item.y === undefined) {
						throw new Error("move action requires x and y");
					}
					return {
						action: "moveComponent",
						params: { targetId: resolveInstanceGuid(item.targetId), position: { x: item.x, y: item.y } },
					};
				}
				case "rename": {
					if (!item.targetId) {
						throw new Error("rename action requires targetId");
					}
					return {
						action: "renameComponent",
						params: { targetId: resolveInstanceGuid(item.targetId), nickName: item.nickName },
					};
				}
				case "set_locked": {
					if (!item.targetId) {
						throw new Error("set_locked action requires targetId");
					}
					return {
						action: "setComponentLocked",
						params: { targetId: resolveInstanceGuid(item.targetId), locked: item.locked },
					};
				}
				case "set_hidden": {
					if (!item.targetId) {
						throw new Error("set_hidden action requires targetId");
					}
					return {
						action: "setComponentHidden",
						params: { targetId: resolveInstanceGuid(item.targetId), hidden: item.hidden },
					};
				}
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
