import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "./edit-handlers.js";

export const ghAddComponentTool = defineTool({
	name: "gh_add_component",
	label: "Add Component",
	description:
		"Add a new component to the Grasshopper canvas. You need the component type GUID — use gh_list_components to find it.",
	parameters: Type.Object({
		componentType: Type.String({
			description: "Component type GUID (e.g. from gh_list_components)",
		}),
		nickName: Type.Optional(
			Type.String({ description: "Optional nickname for the component" })
		),
		x: Type.Number({ description: "X position on canvas" }),
		y: Type.Number({ description: "Y position on canvas" }),
	}),

	execute: createExecute(
		"addComponent",
		(p) => ({ guid: p.componentType, position: { x: p.x, y: p.y } }),
		(_p, r) => `Component added. jobId=${r.jobId}`,
		(p) => `Adding component ${p.componentType} at (${p.x}, ${p.y})...`,
	),
});

export const ghDeleteComponentTool = defineTool({
	name: "gh_delete_component",
	label: "Delete Component",
	description:
		"Delete a component from the Grasshopper canvas by its ID. Use gh_get_canvas first to find the correct ID.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Component ID to delete (from gh_get_canvas)",
		}),
	}),

	execute: createExecute(
		"deleteComponent",
		(p) => ({ targetId: p.targetId }),
		(_p, r) => `Component deleted. jobId=${r.jobId}`,
		(p) => `Deleting component ${p.targetId}...`,
	),
});

export const ghConnectWireTool = defineTool({
	name: "gh_connect_wire",
	label: "Connect Wire",
	description:
		"Connect a source output to a target input using 4 GUIDs copied from gh_get_canvas: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, target input PORT_GUID. Do not use names, nicknames, [id] values, or port labels.",
	parameters: Type.Object({
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
	}),

	execute: createExecute(
		"connectWire",
		(p) => ({ from: { componentId: p.fromComponent, port: p.fromPort }, to: { componentId: p.toComponent, port: p.toPort } }),
		(_p, r) => `Wire connected. jobId=${r.jobId}`,
		(p) => `Connecting wire ${p.fromComponent}:${p.fromPort} → ${p.toComponent}:${p.toPort}...`,
	),
});

export const ghDisconnectWireTool = defineTool({
	name: "gh_disconnect_wire",
	label: "Disconnect Wire",
	description:
  "Disconnect a wire using the same 4 GUIDs from gh_get_canvas used to identify the connection: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, and target input PORT_GUID. Do not use names, nicknames, [id] values, or port labels.",
	parameters: Type.Object({
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
	}),

	execute: createExecute(
		"disconnectWire",
		(p) => ({ from: { componentId: p.fromComponent, port: p.fromPort }, to: { componentId: p.toComponent, port: p.toPort } }),
		(_p, r) => `Wire disconnected. jobId=${r.jobId}`,
		(p) => `Disconnecting wire ${p.fromComponent}:${p.fromPort} → ${p.toComponent}:${p.toPort}...`,
	),
});

export const ghMoveComponentTool = defineTool({
	name: "gh_move_component",
	label: "Move Component",
	description:
		"Move a component to a new position on the canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Component ID to move",
		}),
		x: Type.Number({ description: "New X position" }),
		y: Type.Number({ description: "New Y position" }),
	}),

	execute: createExecute(
		"moveComponent",
		(p) => ({ targetId: p.targetId, position: { x: p.x, y: p.y } }),
		(_p, r) => `Component moved. jobId=${r.jobId}`,
		(p) => `Moving component ${p.targetId} to (${p.x}, ${p.y})...`,
	),
});

export const ghRenameComponentTool = defineTool({
	name: "gh_rename_component",
	label: "Rename Component",
	description:
		"Rename a component's nickname on the canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Component ID to rename",
		}),
		nickName: Type.String({ description: "New nickname" }),
	}),

	execute: createExecute(
		"renameComponent",
		(p) => ({ targetId: p.targetId, nickName: p.nickName }),
		(_p, r) => `Component renamed. jobId=${r.jobId}`,
		(p) => `Renaming component ${p.targetId} to "${p.nickName}"...`,
	),
});

export const ghSetLockedTool = defineTool({
	name: "gh_set_locked",
	label: "Set Locked",
	description:
		"Lock or unlock a component on the Grasshopper canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Component ID",
		}),
		locked: Type.Boolean({ description: "true to lock, false to unlock" }),
	}),

	execute: createExecute(
		"setComponentLocked",
		(p) => ({ targetId: p.targetId, locked: p.locked }),
		(_p, r) => `Lock state set. jobId=${r.jobId}`,
		(p) => `${p.locked ? "Locking" : "Unlocking"} component ${p.targetId}...`,
	),
});

export const ghSetHiddenTool = defineTool({
	name: "gh_set_hidden",
	label: "Set Hidden",
	description:
		"Show or hide a component on the Grasshopper canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Component ID",
		}),
		hidden: Type.Boolean({ description: "true to hide, false to show" }),
	}),

	execute: createExecute(
		"setComponentHidden",
		(p) => ({ targetId: p.targetId, hidden: p.hidden }),
		(_p, r) => `Visibility set. jobId=${r.jobId}`,
		(p) => `${p.hidden ? "Hiding" : "Showing"} component ${p.targetId}...`,
	),
});

export const ghAddGroupTool = defineTool({
	name: "gh_add_group",
	label: "Add Group",
	description:
		"Group multiple components together under a group name in Grasshopper.",
	parameters: Type.Object({
		componentIds: Type.String({
			description: "Comma-separated list of component IDs to group",
		}),
		groupName: Type.String({ description: "Name for the group" }),
	}),

	execute: createExecute(
		"addGroup",
		(p) => ({ componentIds: p.componentIds.split(",").map((s) => s.trim()), groupName: p.groupName }),
		(_p, r) => `Group created. jobId=${r.jobId}`,
		(p) => {
			const ids = p.componentIds.split(",").map((s) => s.trim());
			return `Grouping [${ids.join(", ")}] as "${p.groupName}"...`;
		},
	),
});

export const ghRemoveFromGroupTool = defineTool({
	name: "gh_remove_from_group",
	label: "Remove From Group",
	description:
		"Remove components from a group in Grasshopper.",
	parameters: Type.Object({
		componentIds: Type.String({
			description: "Comma-separated list of component IDs to remove from group",
		}),
		groupName: Type.String({ description: "Name of the group to remove from" }),
	}),

	execute: createExecute(
		"removeFromGroup",
		(p) => ({ componentIds: p.componentIds.split(",").map((s) => s.trim()), groupName: p.groupName }),
		(_p, r) => `Removed from group. jobId=${r.jobId}`,
		(p) => {
			const ids = p.componentIds.split(",").map((s) => s.trim());
			return `Removing [${ids.join(", ")}] from group "${p.groupName}"...`;
		},
	),
});

export const ghSetSliderValueTool = defineTool({
	name: "gh_set_slider_value",
	label: "Set Slider Value",
	description:
		"Set the value of a Number Slider component on the canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Slider component ID",
		}),
		value: Type.Number({ description: "New slider value" }),
	}),

	execute: createExecute(
		"setSliderValue",
		(p) => ({ targetId: p.targetId, value: p.value }),
		(_p, r) => `Slider value set. jobId=${r.jobId}`,
		(p) => `Setting slider ${p.targetId} to ${p.value}...`,
	),
});

export const ghSetPanelTextTool = defineTool({
	name: "gh_set_panel_text",
	label: "Set Panel Text",
	description:
		"Set the text content of a Panel component on the canvas.",
	parameters: Type.Object({
		targetId: Type.String({
			description: "Panel component ID",
		}),
		text: Type.String({ description: "New panel text content" }),
	}),

	execute: createExecute(
		"setPanelText",
		(p) => ({ targetId: p.targetId, text: p.text }),
		(_p, r) => `Panel text set. jobId=${r.jobId}`,
		(p) => `Setting panel ${p.targetId} text...`,
	),
});
