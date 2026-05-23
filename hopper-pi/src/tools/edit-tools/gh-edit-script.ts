import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute, formatDefaultResult } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { fetchScriptCode, formatScriptCodeResponse } from "../query-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"Perform script node operations on the Grasshopper canvas: create a new C# or Python script node with source code and I/O parameters, or set source code on an existing script. The language is chosen at creation time and cannot be changed afterward. For port management (add/remove inputs/outputs, change access type), use gh_edit_components. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("create"),
					x: Type.Number({ description: "X position on canvas" }),
					y: Type.Number({ description: "Y position on canvas" }),
					language: Type.Union([
						Type.Literal("python"),
						Type.Literal("csharp"),
					], { description: "Script language — chosen at creation time and cannot be changed afterward" }),
					code: Type.String({ description: "Script source code" }),
					nickName: Type.Optional(
						Type.String({ description: "Script nickname (defaults to language name)" })
					),
					inputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Input parameter name" }),
						}), { description: "Input parameters to register at creation time" })
					),
					outputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Output parameter name" }),
						}), { description: "Output parameters to register at creation time" })
					),
				}),
				Type.Object({
					action: Type.Literal("setCode"),
					targetId: Type.String({ description: "Script component ID (from gh_get_canvas)" }),
					code: Type.String({ description: "Script source code" }),
				}),
				Type.Object({
					action: Type.Literal("getCode"),
					targetId: Type.String({ description: "Script component ID (from gh_get_canvas)" }),
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