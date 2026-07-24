import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, defaultProgressMsg } from "../edit-handlers.js";
import { resolveInstanceGuid, resolveTypeGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description: "Surgically add, delete, move, rename, lock, or hide Grasshopper canvas objects.",
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
				componentType: Type.Optional(Type.String()),
				targetId: Type.Optional(Type.String()),
				x: Type.Optional(Type.Number()),
				y: Type.Optional(Type.Number()),
				nickName: Type.Optional(Type.String()),
				preview: Type.Optional(Type.Boolean({ description: "Default false." })),
				locked: Type.Optional(Type.Boolean()),
				hidden: Type.Optional(Type.Boolean()),
			}),
			{ minItems: 1 },
		),
	}),
	execute: createExecute(
		(item) => {
			const required: Record<string, string[]> = {
				add: ["componentType", "x", "y"],
				delete: ["targetId"],
				move: ["targetId", "x", "y"],
				rename: ["targetId", "nickName"],
				set_locked: ["targetId", "locked"],
				set_hidden: ["targetId", "hidden"],
			};
			const missing = required[item.action].filter(
				(field) => (item as Record<string, unknown>)[field] == null,
			);
			if (missing.length > 0) throw new Error(`${item.action} requires ${missing.join(", ")}`);
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
		defaultProgressMsg,
	),
});
