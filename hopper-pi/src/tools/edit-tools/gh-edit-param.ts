import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute, formatDefaultResult } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { fetchScriptParams, formatScriptParamsResponse } from "../query-handlers.js";
import { DataMappingType, AccessType } from "./shared-types.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";

import type { CommandAction } from "../../types/commands.js";

export const ghEditParamTool = defineTool({
	name: "gh_edit_param",
	label: "Edit Params",
	description:
		"Manage input/output ports on Grasshopper components that support variable parameters (e.g. script components): add or remove input/output parameters, change access type (item/list/tree), change data mapping (flatten/graft/simplify/reverse), or list current parameter names with their access and mapping state. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("listParams"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
				}),
				Type.Object({
					action: Type.Literal("removeInput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to remove" }),
				}),
				Type.Object({
					action: Type.Literal("removeOutput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to remove" }),
				}),
				Type.Object({
					action: Type.Literal("addInput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to add" }),
					access: Type.Optional(AccessType),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths for the new input" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order for the new input" })
					),
				}),
				Type.Object({
					action: Type.Literal("addOutput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to add" }),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths for the new output" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order for the new output" })
					),
				}),
				Type.Object({
					action: Type.Literal("editAccessType"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name" }),
					access: AccessType,
				}),
				Type.Object({
					action: Type.Literal("editDataMapping"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name" }),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order" })
					),
				}),
			])
		),
	}),
	execute: createHybridExecute(
		"listParams",
		async (item) => {
			const response = await withRequester((req) => fetchScriptParams(req, resolveInstanceGuid(item.targetId)));
			const formatted = formatScriptParamsResponse(response);
			return formatted.content[0].text;
		},
		(item) => {
			switch (item.action) {
				case "addInput":
					return { action: "addScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeInput":
					return { action: "removeScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "addOutput":
					return { action: "addScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeOutput":
					return { action: "removeScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "editAccessType":
					return { action: "editScriptAccess" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, access: item.access } };
				case "editDataMapping":
					return {
						action: "editDataMapping" as CommandAction,
						params: {
							targetId: resolveInstanceGuid(item.targetId),
							name: item.name,
							dataMapping: item.dataMapping,
							simplify: item.simplify,
							reverse: item.reverse,
						},
					};
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId} ${'name' in item ? `'${item.name}'` : ""}...`,
	),
});
