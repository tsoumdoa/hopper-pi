import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditWireTool = defineTool({
	name: "gh_edit_wire",
	label: "Edit Wire",
	description: "Surgically connect or disconnect existing Grasshopper ports by component and port IDs.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("connect"),
					Type.Literal("disconnect"),
				]),
				fromComponent: Type.String(),
				fromPort: Type.String(),
				toComponent: Type.String(),
				toPort: Type.String(),
			}),
			{ minItems: 1 },
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
		(item) => {
			const resolvedFromComp = resolveInstanceGuid(item.fromComponent);
			const resolvedFromPort = resolveInstanceGuid(item.fromPort);
			const resolvedToComp = resolveInstanceGuid(item.toComponent);
			const resolvedToPort = resolveInstanceGuid(item.toPort);
			return `${item.action === "connect" ? "Connecting" : "Disconnecting"} wire ` +
				`from=${item.fromComponent}->${resolvedFromComp}:${item.fromPort}->${resolvedFromPort} ` +
				`to=${item.toComponent}->${resolvedToComp}:${item.toPort}->${resolvedToPort}...`;
		},
	),
});
