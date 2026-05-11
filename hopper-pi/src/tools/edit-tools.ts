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

export const ghEditSliderTool = defineTool({
	name: "gh_edit_slider",
	label: "Edit Slider",
	description:
		"Perform slider operations on the Grasshopper canvas: create a new Number Slider with full configuration, edit the range/digits of an existing slider, or set the current value. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createSlider"),
					Type.Literal("editRange"),
					Type.Literal("setValue"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Slider component ID (from gh_get_canvas) — required for editRange and setValue" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createSlider" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createSlider" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Slider nickname — optional for createSlider (defaults to 'Number Slider')" })
				),
				min: Type.Optional(
					Type.Number({ description: "Minimum value — required for createSlider and editRange" })
				),
				max: Type.Optional(
					Type.Number({ description: "Maximum value — required for createSlider and editRange" })
				),
				value: Type.Optional(
					Type.Number({ description: "Slider value — required for createSlider and setValue" })
				),
				digits: Type.Optional(
					Type.Number({ description: "Decimal digits — required for createSlider and editRange" })
				),
				interval: Type.Optional(
					Type.Number({ description: "Step interval — required for createSlider and editRange" })
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
				case "createSlider": {
					action = "createSlider";
					mappedParams = {
						position: { x: item.x!, y: item.y! },
						nickName: item.nickName,
						min: item.min!,
						max: item.max!,
						value: item.value!,
						digits: item.digits!,
						interval: item.interval!,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Creating slider "${item.nickName ?? "Number Slider"}" at (${item.x}, ${item.y})...` }], details: {} });
					break;
				}
				case "editRange": {
					action = "editSliderRange";
					mappedParams = {
						targetId: resolveInstanceGuid(item.targetId!),
						min: item.min!,
						max: item.max!,
						digits: item.digits!,
						interval: item.interval!,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Editing range of slider ${item.targetId}...` }], details: {} });
					break;
				}
				case "setValue": {
					action = "setSliderValue";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), value: item.value! };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Setting slider ${item.targetId} to ${item.value}...` }], details: {} });
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

export const ghEditPanelTool = defineTool({
	name: "gh_edit_panel",
	label: "Edit Panel",
	description:
		"Perform panel operations on the Grasshopper canvas: create a new Panel with initial text and visual properties, edit visual properties of an existing panel (width, height, multiline mode, background color), or set the text content. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createPanel"),
					Type.Literal("setParam"),
					Type.Literal("setText"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Panel component ID (from gh_get_canvas) — required for setParam and setText" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createPanel" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createPanel" })
				),
				text: Type.Optional(
					Type.String({ description: "Panel text content — required for createPanel and setText" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Panel nickname — optional for createPanel (defaults to 'Panel')" })
				),
				width: Type.Optional(
					Type.Number({ description: "Panel fixed width in pixels — overrides auto-size; use with createPanel or setParam" })
				),
				height: Type.Optional(
					Type.Number({ description: "Panel fixed height in pixels — overrides auto-size; use with createPanel or setParam" })
				),
				multiline: Type.Optional(
					Type.Boolean({ description: "Enable multiline text mode — use with createPanel or setParam" })
				),
				bgColor: Type.Optional(
					Type.String({ description: "Background color as rgba string e.g. 'rgba(255,255,255,255)' — use with createPanel or setParam" })
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
				case "createPanel": {
					action = "createPanel";
					mappedParams = {
						position: { x: item.x!, y: item.y! },
						nickName: item.nickName,
						text: item.text!,
						width: item.width,
						height: item.height,
						multiline: item.multiline,
						bgColor: item.bgColor,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Creating panel "${item.nickName ?? "Panel"}" at (${item.x}, ${item.y})...` }], details: {} });
					break;
				}
				case "setParam": {
					action = "setPanelParams";
					mappedParams = {
						targetId: resolveInstanceGuid(item.targetId!),
						width: item.width,
						height: item.height,
						multiline: item.multiline,
						bgColor: item.bgColor,
					};
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Setting properties of panel ${item.targetId}...` }], details: {} });
					break;
				}
				case "setText": {
					action = "setPanelText";
					mappedParams = { targetId: resolveInstanceGuid(item.targetId!), text: item.text! };
					if (progressFn)
						progressFn({ content: [{ type: "text", text: `Setting text of panel ${item.targetId}...` }], details: {} });
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
