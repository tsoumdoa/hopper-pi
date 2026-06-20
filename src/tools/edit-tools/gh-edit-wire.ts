import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../execute-factory.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditWireTool = defineTool({
	name: "gh_edit_wire",
	label: "Edit Wire",
	description:
		"connect or disconnect wires between component ports by GUID.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("connect"),
					Type.Literal("disconnect"),
				]),
				fromComponent: Type.String({
					description: "Source component GUID",
				}),
				fromPort: Type.String({
					description: "Source output port GUID",
				}),
				toComponent: Type.String({
					description: "Target component GUID",
				}),
				toPort: Type.String({
					description: "Target input port GUID",
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
		(item, result) =>
			`Wire ${item.action === "connect" ? "connected" : "disconnected"}. jobId=${result.jobId}`,
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