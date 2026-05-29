import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute, formatDefaultResult } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { fetchScriptCode, formatScriptCodeResponse } from "../query-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	formatCsharpValidationErrors,
	looksLikeGrasshopperCsharpScript,
	validateCsharpScript,
} from "../../services/csharp-script-validator.js";
import { AccessType, DataMappingType, TypeHintType } from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

type GhEditScriptItem =
	| {
		action: "create";
		x: number;
		y: number;
		language: "python" | "csharp";
		code: string;
		nickName?: string;
		inputs?: Array<{ name: string }>;
		outputs?: Array<{ name: string }>;
	}
	| { action: "setCode"; targetId: string; code: string }
	| { action: "getCode"; targetId: string };

function validateScriptItem(item: GhEditScriptItem): string | null {
	if (item.action === "getCode") return null;

	const isCsharp =
		(item.action === "create" && item.language === "csharp") ||
		(item.action === "setCode" && looksLikeGrasshopperCsharpScript(item.code));

	if (!isCsharp) return null;

	const result = validateCsharpScript(item.code, {
		inputNames: item.action === "create" ? item.inputs?.map((i) => i.name) : undefined,
		outputNames: item.action === "create" ? item.outputs?.map((o) => o.name) : undefined,
	});

	if (result.valid) return null;
	return formatCsharpValidationErrors(result.errors);
}

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
							typeHint: Type.Optional(TypeHintType),
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
							typeHint: Type.Optional(TypeHintType),
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
	execute: async (toolCallId, params, signal, onUpdate) => {
		const validationErrors = (params.items as GhEditScriptItem[])
			.map((item) => validateScriptItem(item))
			.filter((msg): msg is string => msg != null);

		if (validationErrors.length > 0) {
			return {
				content: [{ type: "text" as const, text: validationErrors.join("\n\n") }],
				details: {},
			};
		}

		return runGhEditScript(toolCallId, params, signal, onUpdate);
	},
});

const runGhEditScript = createHybridExecute<GhEditScriptItem>(
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
);