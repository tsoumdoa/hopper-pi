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
import { ScriptIOFields } from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";
import type { ScriptIOParam } from "../../types/commands.js";

type GhEditScriptItem =
	| {
		action: "create";
		x: number;
		y: number;
		language: "python" | "csharp";
		code: string;
		nickName?: string;
		inputs?: ScriptIOParam[];
		outputs?: ScriptIOParam[];
	}
	| {
		action: "setCode";
		targetId: string;
		code: string;
		inputs?: ScriptIOParam[];
		outputs?: ScriptIOParam[];
	}
	| { action: "getCode"; targetId: string };

function validateScriptItem(item: GhEditScriptItem): string | null {
	if (item.action === "getCode") return null;

	const isCsharp =
		(item.action === "create" && item.language === "csharp") ||
		(item.action === "setCode" && looksLikeGrasshopperCsharpScript(item.code));

	if (!isCsharp) return null;

	const result = validateCsharpScript(item.code, {
		inputNames:
			item.action === "create" || item.action === "setCode"
				? item.inputs?.map((i) => i.name)
				: undefined,
		outputNames:
			item.action === "create" || item.action === "setCode"
				? item.outputs?.map((o) => o.name)
				: undefined,
	});

	if (result.valid) return null;
	return formatCsharpValidationErrors(result.errors);
}

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"create C#/Python script nodes, set code, or reconcile I/O. setCode/syncParams: pass full inputs/outputs; same-order renames keep wires; use previousName when reordering or swapping port names. Omit inputs/outputs to leave ports unchanged.",
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
						Type.Array(ScriptIOFields, {
							description: "Desired input ports (full list for create)",
						})
					),
					outputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description: "Desired output ports (full list for create)",
						})
					),
				}),
				Type.Object({
					action: Type.Literal("setCode"),
					targetId: Type.String({ description: "Script component GUID" }),
					code: Type.String({ description: "Script source code" }),
					inputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired input list — reconciles ports. Omit to leave unchanged; [] removes all inputs.",
						})
					),
					outputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired output list — reconciles ports. Omit to leave unchanged; [] removes all outputs.",
						})
					),
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
				return {
					action: "setScriptCode" as CommandAction,
					params: {
						targetId: resolveInstanceGuid(item.targetId),
						code: item.code,
						inputs: item.inputs,
						outputs: item.outputs,
					},
				};
			default:
				return null;
		}
	},
	formatDefaultResult,
	(item) => `${item.action} on ${"targetId" in item ? item.targetId : "new script"}...`,
);
