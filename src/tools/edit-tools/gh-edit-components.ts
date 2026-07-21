import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult, defaultProgressMsg } from "../edit-handlers.js";
import { shortenGuidsInText } from "../result-formatters.js";
import { resolveInstanceGuid, resolveTypeGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description:
		"Add standard Grasshopper components by typeGuid, or delete, move, rename, lock, and hide any canvas object (including widgets). " +
		"add returns the new componentId and its input/output port GUIDs — wire immediately with gh_edit_wire without a canvas read. " +
		"Create widgets with gh_create_widget and change widget-specific properties with gh_mutate_widget.",
	promptSnippet: "Add or manage Grasshopper canvas components and shared object properties",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("add"),
					componentType: Type.String({ description: "Type GUID for add action (from gh_list_components)" }),
					x: Type.Number({ description: "Canvas X (must be > 20)" }),
					y: Type.Number({ description: "Canvas Y (must be > 20)" }),
					nickName: Type.Optional(Type.String({ description: "Display nickname" })),
					preview: Type.Optional(Type.Boolean({ description: "Show geometry preview (default false)" })),
				}),
				Type.Object({
					action: Type.Literal("delete"),
					targetId: Type.String({ description: "Component GUID" }),
				}),
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
			]),
			{ minItems: 1 },
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "add":
					return {
						action: "addComponent" as CommandAction,
						params: {
							typeGuid: resolveTypeGuid(item.componentType!),
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
				if (result.state === "failed" || result.state === "cancelled") {
					return `add FAILED: ${result.error ?? "unknown error"}`;
				}
				if (result.result) {
					return `add completed → ${shortenGuidsInText(result.result)}`;
				}
				return `${item.action} completed. type=${item.componentType}, jobId=${result.jobId}`;
			}
			return formatDefaultResult(item, result);
		},
		defaultProgressMsg,
	),
});
