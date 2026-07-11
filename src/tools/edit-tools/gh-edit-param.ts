import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute, formatDefaultResult } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { fetchScriptParams } from "../canvas-fetch.js";
import { formatScriptParamsResponse } from "../query-handlers.js";
import { DataMappingType, AccessType, TypeHintType, ScriptIOFields } from "./shared-types.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";

import type { CommandAction } from "../../types/commands.js";

export const ghEditParamTool = defineTool({
	name: "gh_edit_param",
	label: "Edit Script Ports",
	description:
		"Manage input/output ports on Grasshopper C# or Python script components only. syncParams reconciles complete port lists; listParams inspects them. " +
		"Use add/remove/editAccessType for one-off property changes (access, type hint, mapping, simplify, reverse). " +
		"For a rename, update code and ports atomically with gh_edit_script setCode; use previousName when reordering or swapping names.",
	promptSnippet: "Inspect or edit Grasshopper script-component input/output ports",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("syncParams"),
					targetId: Type.String({ description: "Script component GUID" }),
					inputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired inputs — updates in place, adds missing, removes extras. Omit (undefined) to leave unchanged; [] removes all inputs.",
						})
					),
					outputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired outputs. Omit to leave unchanged; [] removes all outputs.",
						})
					),
				}),
				Type.Object({
					action: Type.Literal("listParams"),
					targetId: Type.String({ description: "Component GUID" }),
				}),
				Type.Object({
					action: Type.Literal("removeInput"),
					targetId: Type.String({ description: "Component GUID" }),
					name: Type.String({ description: "Parameter name" }),
				}),
				Type.Object({
					action: Type.Literal("removeOutput"),
					targetId: Type.String({ description: "Component GUID" }),
					name: Type.String({ description: "Parameter name" }),
				}),
				Type.Object({
					action: Type.Literal("addInput"),
					targetId: Type.String({ description: "Component GUID" }),
					name: Type.String({ description: "Parameter name" }),
					typeHint: Type.Optional(TypeHintType),
					access: Type.Optional(AccessType),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order" })
					),
				}),
				Type.Object({
					action: Type.Literal("addOutput"),
					targetId: Type.String({ description: "Component GUID" }),
					name: Type.String({ description: "Parameter name" }),
					typeHint: Type.Optional(TypeHintType),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order" })
					),
				}),
				Type.Object({
					action: Type.Literal("editAccessType"),
					targetId: Type.String({ description: "Component GUID" }),
					name: Type.String({ description: "Parameter name" }),
					typeHint: Type.Optional(TypeHintType),
					access: Type.Optional(AccessType),
					dataMapping: Type.Optional(DataMappingType),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order" })
					),
				}),
			]),
			{ minItems: 1 },
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
				case "syncParams":
					return {
						action: "syncScriptParams" as CommandAction,
						params: {
							targetId: resolveInstanceGuid(item.targetId),
							inputs: item.inputs,
							outputs: item.outputs,
						},
					};
				case "addInput":
					return { action: "addScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, typeHint: item.typeHint, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeInput":
					return { action: "removeScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "addOutput":
					return { action: "addScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, typeHint: item.typeHint, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeOutput":
					return { action: "removeScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "editAccessType":
					return { action: "editParamProps" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, typeHint: item.typeHint, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId} ${'name' in item ? `'${item.name}'` : ""}...`,
	),
});
