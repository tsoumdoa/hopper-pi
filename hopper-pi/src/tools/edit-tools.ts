import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, submitCommand } from "./edit-handlers.js";
import type { CommandAction } from "../types/commands.js";
import {
	resolveInstanceGuid,
	resolveTypeGuid,
} from "../services/guid-shortener.js";

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description:
		"Perform component operations on the Grasshopper canvas: add, delete, move, rename, set_locked, or set_hidden. Use gh_get_canvas first to get instance GUIDs for existing components. Use gh_list_components to find type GUIDs for adding new components. Accepts an array of operation items for batch processing.",
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
					Type.String({ description: "Component type GUID (from gh_list_components) — required for add" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for add/move" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for add/move" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Nickname — optional for add, required for rename" })
				),
				locked: Type.Optional(
					Type.Boolean({ description: "true to lock, false to unlock — required for set_locked" })
				),
				hidden: Type.Optional(
					Type.Boolean({ description: "true to hide, false to show — required for set_hidden" })
				),
			})
		),
	}),

	execute: async (_toolCallId, params, _signal, onUpdate) => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as (msg: { content: { type: string; text: string }[]; details: unknown }) => void)
			: undefined;

		const results: string[] = [];
		const jobIds: string[] = [];

		for (const item of params.items) {
			let action: CommandAction;
			let mappedParams: unknown;

			switch (item.action) {
				case "add": {
					action = "addComponent";
					mappedParams = {
						guid: resolveTypeGuid(item.componentType!),
						position: { x: item.x!, y: item.y! },
						nickName: item.nickName,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Adding component ${item.componentType} at (${item.x}, ${item.y})...` }], details: {} });
					break;
				}
				case "delete": {
					action = "deleteComponent";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!) };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Deleting component ${item.targetId}...` }], details: {} });
					break;
				}
				case "move": {
					action = "moveComponent";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), position: { x: item.x!, y: item.y! } };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Moving component ${item.targetId} to (${item.x}, ${item.y})...` }], details: {} });
					break;
				}
				case "rename": {
					action = "renameComponent";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), nickName: item.nickName };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Renaming component ${item.targetId} to "${item.nickName}"...` }], details: {} });
					break;
				}
				case "set_locked": {
					action = "setComponentLocked";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), locked: item.locked };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `${item.locked ? "Locking" : "Unlocking"} component ${item.targetId}...` }], details: {} });
					break;
				}
				case "set_hidden": {
					action = "setComponentHidden";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), hidden: item.hidden };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `${item.hidden ? "Hiding" : "Showing"} component ${item.targetId}...` }], details: {} });
					break;
				}
				default:
					results.push(`Unknown action: ${item.action}`);
					continue;
			}

			const result = await submitCommand(action, mappedParams);
			results.push(`${item.action} completed. jobId=${result.jobId}`);
			jobIds.push(result.jobId);
		}

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details: { jobIds },
		};
	},
});

export const ghEditWireTool = defineTool({
	name: "gh_edit_wire",
	label: "Edit Wire",
	description:
		"Connect or disconnect wires between component ports using 4 GUID aliases copied from gh_get_canvas: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, target input PORT_GUID. Full GUIDs also work. Do not use names, nicknames, [id] values, or port labels. Accepts an array of wire definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("connect"),
					Type.Literal("disconnect"),
				]),
				fromComponent: Type.String({
					description: "Copy the COMPONENT_GUID= value from the SOURCE component's header row in gh_get_canvas output.",
				}),
				fromPort: Type.String({
					description: "Copy the PORT_GUID= value from the SOURCE component's OUTPUTS section in gh_get_canvas output.",
				}),
				toComponent: Type.String({
					description: "Copy the COMPONENT_GUID= value from the TARGET component's header row in gh_get_canvas output.",
				}),
				toPort: Type.String({
					description: "Copy the PORT_GUID= value from the TARGET component's INPUTS section in gh_get_canvas output.",
				}),
			})
		),
	}),

	execute: async (_toolCallId, params, _signal, onUpdate) => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as (msg: { content: { type: string; text: string }[]; details: unknown }) => void)
			: undefined;

		const results: string[] = [];
		const jobIds: string[] = [];

		for (const item of params.items) {
			const action: CommandAction = item.action === "connect" ? "connectWire" : "disconnectWire";
			const mappedParams = {
				from: { componentId: resolveInstanceGuid(item.fromComponent), port: resolveInstanceGuid(item.fromPort) },
				to: { componentId: resolveInstanceGuid(item.toComponent), port: resolveInstanceGuid(item.toPort) },
			};

			if (progressFn)
				progressFn({ content: [{ type: "text", text: `${item.action === "connect" ? "Connecting" : "Disconnecting"} wire ${item.fromComponent}:${item.fromPort} → ${item.toComponent}:${item.toPort}...` }], details: {} });

			const result = await submitCommand(action, mappedParams);
			results.push(`Wire ${item.action === "connect" ? "connected" : "disconnected"}. jobId=${result.jobId}`);
			jobIds.push(result.jobId);
		}

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details: { jobIds },
		};
	},
});



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

	execute: async (_toolCallId, params, _signal, onUpdate) => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as (msg: { content: { type: string; text: string }[]; details: unknown }) => void)
			: undefined;

		const results: string[] = [];
		const jobIds: string[] = [];

		for (const item of params.items) {
			let action: CommandAction;
			let mappedParams: unknown;

			switch (item.operation) {
				case "add": {
					action = "addGroup";
					mappedParams = {
						componentIds: item.componentIds
							?.split(",")
							?.map((s) => s.trim())
							?.map((s) => resolveInstanceGuid(s)),
						groupName: item.groupName,
						color: item.color ?? "rgba(255,255,255,150)",
						border: item.border,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Adding group "${item.groupName}"...` }], details: {} });
					break;
				}
				case "remove": {
					action = "removeFromGroup";
					mappedParams = {
						componentIds: item.componentIds
							?.split(",")
							?.map((s) => s.trim())
							?.map((s) => resolveInstanceGuid(s)),
						groupName: item.groupName,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Removing from group "${item.groupName}"...` }], details: {} });
					break;
				}
				case "delete": {
					action = "deleteGroup";
					mappedParams = { groupName: item.groupName };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Deleting group "${item.groupName}"...` }], details: {} });
					break;
				}
				case "changeColor": {
					action = "changeGroupColor";
					mappedParams = {
						groupName: item.groupName,
						color: item.color ?? "rgba(255,255,255,150)",
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Changing color of group "${item.groupName}"...` }], details: {} });
					break;
				}
				case "rename": {
					action = "renameGroup";
					mappedParams = {
						groupName: item.groupName,
						name: item.name,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Renaming group "${item.groupName}" to "${item.name}"...` }], details: {} });
					break;
				}
				case "changeStyle": {
					action = "changeGroupStyle";
					mappedParams = {
						groupName: item.groupName,
						color: item.color,
						name: item.name,
						border: item.border,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Changing style of group "${item.groupName}"...` }], details: {} });
					break;
				}
				default:
					results.push(`Unknown operation: ${item.operation}`);
					continue;
			}

			const result = await submitCommand(action, mappedParams);
			results.push(`${item.operation} on "${item.groupName}". jobId=${result.jobId}`);
			jobIds.push(result.jobId);
		}

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details: { jobIds },
		};
	},
});

export const ghSetSliderValueTool = defineTool({
	name: "gh_set_slider_value",
	label: "Set Slider Value",
	description:
		"Set the values of one or more Number Slider components on the canvas. Accepts an array of slider value definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Slider component ID",
				}),
				value: Type.Number({ description: "New slider value" }),
			})
		),
	}),

	execute: createExecute(
		"setSliderValue",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), value: p.value }),
		(_p, r) => `Slider value set. jobId=${r.jobId}`,
		(p) => `Setting slider ${p.targetId} to ${p.value}...`,
	),
});

export const ghSetPanelTextTool = defineTool({
	name: "gh_set_panel_text",
	label: "Set Panel Text",
	description:
		"Set the text content of one or more Panel components on the canvas. Accepts an array of panel text definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Panel component ID",
				}),
				text: Type.String({ description: "New panel text content" }),
			})
		),
	}),

	execute: createExecute(
		"setPanelText",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), text: p.text }),
		(_p, r) => `Panel text set. jobId=${r.jobId}`,
		(p) => `Setting panel ${p.targetId} text...`,
	),
});
