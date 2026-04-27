import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute, formatDefaultResult } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { fetchScriptCode, formatScriptCodeResponse } from "../query-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import { AccessType, DataMappingType } from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"create C#/Python script nodes with source code and I/O, or set code on existing scripts. Use gh_edit_param for port management.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("create"),
					x: Type.Number({ description: "Canvas X" }),
					y: Type.Number({ description: "Canvas Y" }),
					language: Type.Union([
						Type.Literal("python"),
						Type.Literal("csharp"),
					], { description: "Script language (immutable after creation)" }),
					code: Type.String({ description: "Script source code" }),
					nickName: Type.Optional(
						Type.String({ description: "Script nickname" })
					),
					inputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Input parameter name" }),
							access: Type.Optional(AccessType),
							dataMapping: Type.Optional(DataMappingType),
							simplify: Type.Optional(
								Type.Boolean({ description: "Simplify data paths" })
							),
							reverse: Type.Optional(
								Type.Boolean({ description: "Reverse item order" })
							),
						}), { description: "Input parameters" })
					),
					outputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Output parameter name" }),
						}), { description: "Output parameters" })
					),
				}),
				Type.Object({
					action: Type.Literal("setCode"),
					targetId: Type.String({ description: "Script component GUID" }),
					code: Type.String({ description: "Script source code" }),
				}),
				Type.Object({
					action: Type.Literal("getCode"),
					targetId: Type.String({ description: "Script component GUID" }),
				}),
			])
		),
	}),
	execute: createHybridExecute(
		"getCode",
		async (item) => {
			if (item.action !== "getCode") return "";
			const response = await withRequester((req) => fetchScriptCode(req, resolveInstanceGuid(item.targetId)));
			const formatted = formatScriptCodeResponse(response);
			return formatted.content[0].text;
		},
		(item) => {
			switch (item.action) {
				case "create":
					return {
						action: "createScriptNode" as CommandAction,
						params: {
							position: { x: item.x, y: item.y },
							language: item.language,
							code: item.code,
							nickName: item.nickName,
							inputs: item.inputs,
							outputs: item.outputs,
						},
					};
				case "setCode":
					return { action: "setScriptCode" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), code: item.code } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${"targetId" in item ? item.targetId : "new script"}...`,
	),
});