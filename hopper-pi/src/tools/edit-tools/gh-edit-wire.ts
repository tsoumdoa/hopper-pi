import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

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
	execute: createExecute(
		(item) => ({
			action: item.action === "connect" ? ("connectWire" as CommandAction) : ("disconnectWire" as CommandAction),
			params: {
				from: { componentId: resolveInstanceGuid(item.fromComponent), port: resolveInstanceGuid(item.fromPort) },
				to: { componentId: resolveInstanceGuid(item.toComponent), port: resolveInstanceGuid(item.toPort) },
			},
		}),
		(item, result) => {
			const resolvedFromComp = resolveInstanceGuid(item.fromComponent);
			const resolvedFromPort = resolveInstanceGuid(item.fromPort);
			const resolvedToComp = resolveInstanceGuid(item.toComponent);
			const resolvedToPort = resolveInstanceGuid(item.toPort);
			return `Wire ${item.action === "connect" ? "connected" : "disconnected"}. ` +
				`from=${item.fromComponent}->${resolvedFromComp}:${item.fromPort}->${resolvedFromPort} ` +
				`to=${item.toComponent}->${resolvedToComp}:${item.toPort}->${resolvedToPort}, jobId=${result.jobId}`;
		},
		(item) => `${item.action === "connect" ? "Connecting" : "Disconnecting"} wire ${item.fromComponent}:${item.fromPort} → ${item.toComponent}:${item.toPort}...`,
	),
});