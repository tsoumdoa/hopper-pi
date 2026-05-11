import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, submitCommand } from "./edit-handlers.js";
import type { CommandAction } from "../types/commands.js";
import {
	resolveInstanceGuid,
	resolveTypeGuid,
} from "../services/guid-shortener.js";

export const ghAddComponentTool = defineTool({
	name: "gh_add_component",
	label: "Add Component",
	description:
		"Add one or more new components to the Grasshopper canvas. You need the component type GUID alias from gh_list_components (or full GUID). Accepts an array of component definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				componentType: Type.String({
					description: "Component type GUID (e.g. from gh_list_components)",
				}),
				nickName: Type.Optional(
					Type.String({ description: "Optional nickname for the component" })
				),
				x: Type.Number({ description: "X position on canvas" }),
				y: Type.Number({ description: "Y position on canvas" }),
			})
		),
	}),

	execute: createExecute(
		"addComponent",
		(p) => ({ guid: resolveTypeGuid(p.componentType), position: { x: p.x, y: p.y }, nickName: p.nickName }),
		(_p, r) => `Component added. jobId=${r.jobId}`,
		(p) => `Adding component ${p.componentType} at (${p.x}, ${p.y})...`,
	),
});

export const ghDeleteComponentTool = defineTool({
	name: "gh_delete_component",
	label: "Delete Component",
	description:
		"Delete one or more components from the Grasshopper canvas by instance GUID alias (or full GUID). Use gh_get_canvas first to get identifiers. Accepts an array of target definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Component ID to delete (from gh_get_canvas)",
				}),
			})
		),
	}),

	execute: createExecute(
		"deleteComponent",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId) }),
		(_p, r) => `Component deleted. jobId=${r.jobId}`,
		(p) => `Deleting component ${p.targetId}...`,
	),
});

export const ghConnectWireTool = defineTool({
	name: "gh_connect_wire",
	label: "Connect Wire",
	description:
		"Connect one or more source outputs to target inputs using 4 GUID aliases copied from gh_get_canvas: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, target input PORT_GUID. Full GUIDs also work. Do not use names, nicknames, [id] values, or port labels. Accepts an array of wire definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
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

	execute: createExecute(
		"connectWire",
		(p) => ({
			from: { componentId: resolveInstanceGuid(p.fromComponent), port: resolveInstanceGuid(p.fromPort) },
			to: { componentId: resolveInstanceGuid(p.toComponent), port: resolveInstanceGuid(p.toPort) },
		}),
		(_p, r) => `Wire connected. jobId=${r.jobId}`,
		(p) => `Connecting wire ${p.fromComponent}:${p.fromPort} → ${p.toComponent}:${p.toPort}...`,
	),
});

export const ghDisconnectWireTool = defineTool({
	name: "gh_disconnect_wire",
	label: "Disconnect Wire",
	description:
		"Disconnect one or more wires using the same 4 GUID aliases from gh_get_canvas used to identify the connection: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, and target input PORT_GUID. Full GUIDs also work. Do not use names, nicknames, [id] values, or port labels. Accepts an array of wire definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
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

	execute: createExecute(
		"disconnectWire",
		(p) => ({
			from: { componentId: resolveInstanceGuid(p.fromComponent), port: resolveInstanceGuid(p.fromPort) },
			to: { componentId: resolveInstanceGuid(p.toComponent), port: resolveInstanceGuid(p.toPort) },
		}),
		(_p, r) => `Wire disconnected. jobId=${r.jobId}`,
		(p) => `Disconnecting wire ${p.fromComponent}:${p.fromPort} → ${p.toComponent}:${p.toPort}...`,
	),
});

export const ghMoveComponentTool = defineTool({
	name: "gh_move_component",
	label: "Move Component",
	description:
		"Move one or more components to new positions on the canvas. Accepts an array of move definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Component ID to move",
				}),
				x: Type.Number({ description: "New X position" }),
				y: Type.Number({ description: "New Y position" }),
			})
		),
	}),

	execute: createExecute(
		"moveComponent",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), position: { x: p.x, y: p.y } }),
		(_p, r) => `Component moved. jobId=${r.jobId}`,
		(p) => `Moving component ${p.targetId} to (${p.x}, ${p.y})...`,
	),
});

export const ghRenameComponentTool = defineTool({
	name: "gh_rename_component",
	label: "Rename Component",
	description:
		"Rename one or more components' nicknames on the canvas. Accepts an array of rename definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Component ID to rename",
				}),
				nickName: Type.String({ description: "New nickname" }),
			})
		),
	}),

	execute: createExecute(
		"renameComponent",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), nickName: p.nickName }),
		(_p, r) => `Component renamed. jobId=${r.jobId}`,
		(p) => `Renaming component ${p.targetId} to "${p.nickName}"...`,
	),
});

export const ghSetLockedTool = defineTool({
	name: "gh_set_locked",
	label: "Set Locked",
	description:
		"Lock or unlock one or more components on the Grasshopper canvas. Accepts an array of lock definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Component ID",
				}),
				locked: Type.Boolean({ description: "true to lock, false to unlock" }),
			})
		),
	}),

	execute: createExecute(
		"setComponentLocked",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), locked: p.locked }),
		(_p, r) => `Lock state set. jobId=${r.jobId}`,
		(p) => `${p.locked ? "Locking" : "Unlocking"} component ${p.targetId}...`,
	),
});

export const ghSetHiddenTool = defineTool({
	name: "gh_set_hidden",
	label: "Set Hidden",
	description:
		"Show or hide one or more components on the Grasshopper canvas. Accepts an array of visibility definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				targetId: Type.String({
					description: "Component ID",
				}),
				hidden: Type.Boolean({ description: "true to hide, false to show" }),
			})
		),
	}),

	execute: createExecute(
		"setComponentHidden",
		(p) => ({ targetId: resolveInstanceGuid(p.targetId), hidden: p.hidden }),
		(_p, r) => `Visibility set. jobId=${r.jobId}`,
		(p) => `${p.hidden ? "Hiding" : "Showing"} component ${p.targetId}...`,
	),
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
