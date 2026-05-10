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
		(p, r) => `Component (id=${p.componentType}) added. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Component deleted. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
		(p) => `Deleting component ${p.targetId}...`,
	),
});

export const ghConnectWireTool = defineTool({
	name: "gh_connect_wire",
	label: "Connect Wire",
	description:
		"Connect an output port of one component to an input port of another. ALL 4 parameters must be GUID strings copied from gh_get_canvas output. " +
		"Step 1: call gh_get_canvas. Step 2: copy the 4 GUID values from its output into the parameters below." +
		"\n" +
		"The gh_get_canvas output format:" +
		"\n  [Cir] Cir (Circle)" +
		"\n    COMPONENT_GUID=aaaa-bbbb-cccc-dddd-1111-2222-3333-4444  <-- copy this as fromComponent" +
		"\n    OUTPUTS (fromPort values):" +
		"\n      PORT_GUID=eeee-ffff-0000-1111-2222-3333-4444-5555  (C)  <-- copy this as fromPort" +
		"\n    INPUTS (toPort values):" +
		"\n      PORT_GUID=6666-7777-8888-9999-aaaa-bbbb-cccc-dddd  (R)  <-- copy this as toPort" +
		"\n" +
		"For the TARGET component, also copy its COMPONENT_GUID as toComponent, and its input PORT_GUID as toPort." +
		"\n" +
		"ALL 4 PARAMS ARE GUIDS (hex strings like 'aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111'):" +
		"\n  fromComponent = COMPONENT_GUID line from SOURCE component (the guid= value on its header row)" +
		"\n  fromPort     = PORT_GUID line from SOURCE component's OUTPUTS section" +
		"\n  toComponent   = COMPONENT_GUID line from TARGET component (the guid= value on its header row)" +
		"\n  toPort       = PORT_GUID line from TARGET component's INPUTS section" +
		"\n" +
		"INVALID (will fail): fromComponent='Circle', fromPort='C', fromPort='c', toPort='Area', toPort='g', toPort='radius'" +
		"\nVALID: fromComponent='aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111'  fromPort='eeee-ffff-...'",
	parameters: Type.Object({
		fromComponent: Type.String({
			description: "Copy the COMPONENT_GUID= value from the SOURCE component's header row in gh_get_canvas output. This is a hex GUID string like 'aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111'. NOT the [id] in brackets, NOT a nickname.",
		}),
		fromPort: Type.String({
			description: "Copy the PORT_GUID= value from the SOURCE component's OUTPUTS section in gh_get_canvas output. Hex GUID string like 'eeee-ffff-0000-1111-2222-3333-4444-5555'. NOT the nickname in parens.",
		}),
		toComponent: Type.String({
			description: "Copy the COMPONENT_GUID= value from the TARGET component's header row in gh_get_canvas output. Hex GUID string like '6666-7777-8888-9999-aaaa-bbbb-cccc-dddd'. NOT the [id] in brackets.",
		}),
		toPort: Type.String({
			description: "Copy the PORT_GUID= value from the TARGET component's INPUTS section in gh_get_canvas output. Hex GUID string like 'ffff-0000-1111-2222-3333-4444-5556-6666'. NOT the nickname in parens.",
		}),
	}),

	execute: createExecute(
		"connectWire",
		(p) => ({ from: { componentId: p.fromComponent, port: p.fromPort }, to: { componentId: p.toComponent, port: p.toPort } }),
		(_p, r) => `Wire connected. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
		(p) => `Connecting wire ${p.fromComponent}:${p.fromPort} → ${p.toComponent}:${p.toPort}...`,
	),
});

export const ghDisconnectWireTool = defineTool({
	name: "gh_disconnect_wire",
	label: "Disconnect Wire",
	description:
		"Disconnect a wire between two components. ALL 4 parameters must be GUID strings copied from gh_get_canvas output. " +
		"Use the SAME 4 GUID values that were used (or would be used) to connect this wire via gh_connect_wire." +
		"\n" +
		"The gh_get_canvas output format:" +
		"\n  [Cir] Cir (Circle)" +
		"\n    COMPONENT_GUID=aaaa-bbbb-cccc-dddd-1111-2222-3333-4444  <-- copy this as fromComponent" +
		"\n    OUTPUTS:" +
		"\n      PORT_GUID=eeee-ffff-0000-1111-2222-3333-4444-5555  <-- copy this as fromPort" +
		"\n    INPUTS:" +
		"\n      PORT_GUID=6666-7777-8888-9999-aaaa-bbbb-cccc-dddd  (R)  <-- copy this as toPort" +
		"\n" +
		"For the TARGET component, also copy its COMPONENT_GUID as toComponent, and its input PORT_GUID as toPort." +
		"\n" +
		"ALL 4 PARAMS ARE GUIDS (hex strings like 'aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111'):" +
		"\n  fromComponent = COMPONENT_GUID line from SOURCE component's header row" +
		"\n  fromPort     = PORT_GUID line from SOURCE component's OUTPUTS section" +
		"\n  toComponent   = COMPONENT_GUID line from TARGET component's header row" +
		"\n  toPort       = PORT_GUID line from TARGET component's INPUTS section" +
		"\n" +
		"INVALID (will fail): fromComponent='Circle', fromPort='C', toPort='Area', toPort='g'" +
		"\nVALID: fromComponent='aaaa-bbbb-...'  fromPort='eeee-ffff-...'",
	parameters: Type.Object({
		fromComponent: Type.String({
			description: "Copy the COMPONENT_GUID= value from the SOURCE component's header row in gh_get_canvas output. Hex GUID string like 'aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111'. NOT the [id], NOT a nickname.",
		}),
		fromPort: Type.String({
			description: "Copy the PORT_GUID= value from the SOURCE component's OUTPUTS section in gh_get_canvas output. Hex GUID string like 'eeee-ffff-0000-1111-2222-3333-4444-5555'. NOT the nickname in parens.",
		}),
		toComponent: Type.String({
			description: "Copy the COMPONENT_GUID= value from the TARGET component's header row in gh_get_canvas output. Hex GUID string like '6666-7777-8888-9999-aaaa-bbbb-cccc-dddd'. NOT the [id] in brackets.",
		}),
		toPort: Type.String({
			description: "Copy the PORT_GUID= value from the TARGET component's INPUTS section in gh_get_canvas output. Hex GUID string like 'ffff-0000-1111-2222-3333-4444-5556-6666'. NOT the nickname in parens.",
		}),
	}),

	execute: createExecute(
		"disconnectWire",
		(p) => ({ from: { componentId: p.fromComponent, port: p.fromPort }, to: { componentId: p.toComponent, port: p.toPort } }),
		(_p, r) => `Wire disconnected. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Component moved. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Component renamed. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Lock state set. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Visibility set. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Group created. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Removed from group. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Slider value set. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
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
		(_p, r) => `Panel text set. jobId=${r.jobId}${r.commandId ? `, cmd=${r.commandId}` : ""}`,
		(p) => `Setting panel ${p.targetId} text...`,
	),
});
