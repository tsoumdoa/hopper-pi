import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute } from "../edit-handlers.js";
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
		"Inspect or surgically edit existing Grasshopper script ports; syncParams reconciles complete lists.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("syncParams"),
					Type.Literal("listParams"),
					Type.Literal("removeInput"),
					Type.Literal("removeOutput"),
					Type.Literal("addInput"),
					Type.Literal("addOutput"),
					Type.Literal("editAccessType"),
				]),
				targetId: Type.String(),
				name: Type.Optional(Type.String()),
				inputs: Type.Optional(Type.Array(ScriptIOFields, {
					description: "Full desired inputs; omit to preserve, [] to remove all.",
				})),
				outputs: Type.Optional(Type.Array(ScriptIOFields, {
					description: "Full desired outputs; omit to preserve, [] to remove all.",
				})),
				typeHint: Type.Optional(TypeHintType),
				access: Type.Optional(AccessType),
				dataMapping: Type.Optional(DataMappingType),
				simplify: Type.Optional(Type.Boolean()),
				reverse: Type.Optional(Type.Boolean()),
			}),
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
			if (
				item.action !== "syncParams" &&
				item.action !== "listParams" &&
				!item.name
			) {
				throw new Error(`${item.action} requires name`);
			}
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
		(item) => `${item.action} on ${item.targetId}${item.name ? ` '${item.name}'` : ""}...`,
	),
});
