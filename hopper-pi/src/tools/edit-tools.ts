import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { nanoid } from "nanoid";
import { Publisher } from "../infra/publisher.js";
import { Subscriber } from "../infra/subscriber.js";
import { COMMAND_ACK_TIMEOUT_MS } from "../infra/connection.js";
import type {
	CommandAction,
	SubmitJobRequest,
} from "../types/commands.js";
// ── Internal: submit a command and wait for ACK ─────────────────────

async function submitCommand(
	action: CommandAction,
	params: unknown
): Promise<{ jobId: string; commandId: string | null }> {
	const jobId = `job-${nanoid(8)}`;
	const request: SubmitJobRequest = {
		type: "submitJob",
		jobId,
		command: { action, params: params as SubmitJobRequest["command"]["params"] },
	};

	const publisher = new Publisher();
	let ack: { jobId: string; commandId: string } | null = null;

	try {
		await publisher.connect();
		await publisher.publishCommand(request);

		// Wait for job status ACK on SUB socket
		const subscriber = new Subscriber();
		try {
			await subscriber.connect();
			await subscriber.subscribeTopic("gh.job.status");

			const deadline = Date.now() + COMMAND_ACK_TIMEOUT_MS;
			while (Date.now() < deadline) {
				try {
					const msg = await subscriber.receiveOne(500);
					if (msg?.type === "gh.job.status" && msg.jobId === jobId && msg.state === "queued") {
						ack = { jobId: msg.jobId, commandId: msg.commandId };
						break;
					}
				} catch {
					break;
				}
			}
		} finally {
			await subscriber.close();
		}
	} finally {
		await publisher.close();
	}

	return { jobId, commandId: ack?.commandId ?? null };
}

// ── Tool definitions ────────────────────────────────────────────────

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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Adding component ${params.componentType} at (${params.x}, ${params.y})...` }], details: {} });

		const result = await submitCommand("addComponent", {
			typeGuid: params.componentType,
			position: { x: params.x, y: params.y },
		});

		return {
			content: [{
				type: "text",
				text: `Component added. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Deleting component ${params.targetId}...` }], details: {} });

		const result = await submitCommand("deleteComponent", {
			targetId: params.targetId,
		});

		return {
			content: [{
				type: "text",
				text: `Component deleted. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Connecting wire ${params.fromComponent}:${params.fromPort} → ${params.toComponent}:${params.toPort}...` }], details: {} });

		const result = await submitCommand("connectWire", {
			from: { componentId: params.fromComponent, port: params.fromPort },
			to: { componentId: params.toComponent, port: params.toPort },
		});

		return {
			content: [{
				type: "text",
				text: `Wire connected. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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
		"\n      PORT_GUID=eeee-ffff-0000-1111-2222-3333-4444-5555  (C)  <-- copy this as fromPort" +
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
			description: "Copy the COMPONENT_GUID= value from the TARGET component's header row in gh_get_canvas output. Hex GUID string like '6666-7777-8888-9999-aaaa-bbbb-cccc-dddd'. NOT the [id], NOT a nickname.",
		}),
		toPort: Type.String({
			description: "Copy the PORT_GUID= value from the TARGET component's INPUTS section in gh_get_canvas output. Hex GUID string like 'ffff-0000-1111-2222-3333-4444-5556-6666'. NOT the nickname in parens.",
		}),
	}),

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Disconnecting wire ${params.fromComponent}:${params.fromPort} → ${params.toComponent}:${params.toPort}...` }], details: {} });

		const result = await submitCommand("disconnectWire", {
			from: { componentId: params.fromComponent, port: params.fromPort },
			to: { componentId: params.toComponent, port: params.toPort },
		});

		return {
			content: [{
				type: "text",
				text: `Wire disconnected. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Moving component ${params.targetId} to (${params.x}, ${params.y})...` }], details: {} });

		const result = await submitCommand("moveComponent", {
			targetId: params.targetId,
			position: { x: params.x, y: params.y },
		});

		return {
			content: [{
				type: "text",
				text: `Component moved. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Renaming component ${params.targetId} to "${params.nickName}"...` }], details: {} });

		const result = await submitCommand("renameComponent", {
			targetId: params.targetId,
			nickName: params.nickName,
		});

		return {
			content: [{
				type: "text",
				text: `Component renamed. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `${params.locked ? "Locking" : "Unlocking"} component ${params.targetId}...` }], details: {} });

		const result = await submitCommand("setComponentLocked", {
			targetId: params.targetId,
			locked: params.locked,
		});

		return {
			content: [{
				type: "text",
				text: `Lock state set. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `${params.hidden ? "Hiding" : "Showing"} component ${params.targetId}...` }], details: {} });

		const result = await submitCommand("setComponentHidden", {
			targetId: params.targetId,
			hidden: params.hidden,
		});

		return {
			content: [{
				type: "text",
				text: `Visibility set. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		const ids = params.componentIds.split(",").map((s) => s.trim());
		onUpdate?.({ content: [{ type: "text", text: `Grouping [${ids.join(", ")}] as "${params.groupName}"...` }], details: {} });

		const result = await submitCommand("addGroup", {
			componentIds: ids,
			groupName: params.groupName,
		});

		return {
			content: [{
				type: "text",
				text: `Group created. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		const ids = params.componentIds.split(",").map((s) => s.trim());
		onUpdate?.({ content: [{ type: "text", text: `Removing [${ids.join(", ")}] from group "${params.groupName}"...` }], details: {} });

		const result = await submitCommand("removeFromGroup", {
			componentIds: ids,
			groupName: params.groupName,
		});

		return {
			content: [{
				type: "text",
				text: `Removed from group. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Setting slider ${params.targetId} to ${params.value}...` }], details: {} });

		const result = await submitCommand("setSliderValue", {
			targetId: params.targetId,
			value: params.value,
		});

		return {
			content: [{
				type: "text",
				text: `Slider value set. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
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

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: `Setting panel ${params.targetId} text...` }], details: {} });

		const result = await submitCommand("setPanelText", {
			targetId: params.targetId,
			text: params.text,
		});

		return {
			content: [{
				type: "text",
				text: `Panel text set. jobId=${result.jobId}${result.commandId ? `, cmd=${result.commandId}` : ""}`,
			}],
			details: result,
		};
	},
});
