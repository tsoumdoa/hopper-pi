import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { executeGhEditScript } from "../../services/gh-edit-script-executor.js";
import {
	renderGhEditScriptCall,
	renderGhEditScriptResult,
	type GhEditScriptDetails,
} from "./gh-edit-script-render.js";
import { ScriptIOFields } from "./shared-types.js";
import type { GhEditScriptItem } from "../../types/gh-edit-script.js";

const PatchScopeType = Type.Union([
	Type.Literal("runScriptBody"),
	Type.Literal("runScript"),
	Type.Literal("helpers"),
	Type.Literal("references"),
	Type.Literal("full"),
], { description: "C# default runScriptBody; Python default full." });

const LinePatchType = Type.Union([
	Type.Object({
		op: Type.Literal("insert"),
		afterLine: Type.Number({ description: "0 inserts before line 1." }),
		lines: Type.Array(Type.String()),
	}),
	Type.Object({
		op: Type.Literal("replace"),
		startLine: Type.Number(),
		endLine: Type.Number(),
		lines: Type.Array(Type.String()),
	}),
	Type.Object({
		op: Type.Literal("delete"),
		startLine: Type.Number(),
		endLine: Type.Number(),
	}),
]);

const CsharpScriptPartsFields = Type.Object({
	references: Type.Optional(Type.Array(Type.String())),
	runScript: Type.String({ description: "Complete RunScript method, without class wrapper." }),
	helpers: Type.Optional(Type.String()),
});

function validateRequiredFields(items: Array<Record<string, unknown>>): string[] {
	const errors: string[] = [];
	for (const [index, item] of items.entries()) {
		if (item.action === "create") {
			if (typeof item.x !== "number" || typeof item.y !== "number" || !item.language) {
				errors.push(`items[${index}]: create requires x, y, and language`);
			}
		} else if (
			item.action === "setCode" ||
			item.action === "patchCode" ||
			item.action === "getCode" ||
			item.action === "getCodeParts"
		) {
			if (typeof item.targetId !== "string" || !item.targetId) {
				errors.push(`items[${index}]: ${item.action} requires targetId`);
			}
		}
		if (
			item.action === "patchCode" &&
			(!Array.isArray(item.patches) || item.patches.length === 0)
		) {
			errors.push(`items[${index}]: patchCode requires patches`);
		}
	}
	return errors;
}

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"Surgically create, inspect, or edit Grasshopper C#/Python scripts; C# prefers scriptParts and Python uses full code.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("create"),
					Type.Literal("setCode"),
					Type.Literal("patchCode"),
					Type.Literal("getCode"),
					Type.Literal("getCodeParts"),
				]),
				targetId: Type.Optional(Type.String()),
				x: Type.Optional(Type.Number()),
				y: Type.Optional(Type.Number()),
				language: Type.Optional(Type.Union([
					Type.Literal("python"),
					Type.Literal("csharp"),
				])),
				code: Type.Optional(Type.String()),
				scriptParts: Type.Optional(CsharpScriptPartsFields),
				nickName: Type.Optional(Type.String()),
				inputs: Type.Optional(Type.Array(ScriptIOFields, {
					description: "Full desired list; omit to preserve, [] to remove all.",
				})),
				outputs: Type.Optional(Type.Array(ScriptIOFields, {
					description: "Full desired list; omit to preserve, [] to remove all.",
				})),
				patches: Type.Optional(Type.Array(LinePatchType, { minItems: 1 })),
				scope: Type.Optional(PatchScopeType),
			}),
			{ minItems: 1 },
		),
	}),
	execute: async (_toolCallId, params, _signal, onUpdate) => {
		const requiredErrors = validateRequiredFields(
			params.items as Array<Record<string, unknown>>,
		);
		if (requiredErrors.length > 0) {
			return {
				content: [{ type: "text" as const, text: requiredErrors.join("\n") }],
				details: {
					summaries: [],
					results: requiredErrors,
					items: params.items,
					queryCount: 0,
					mutationCount: 0,
					validationErrors: requiredErrors,
				} satisfies GhEditScriptDetails,
			};
		}
		const items = params.items as GhEditScriptItem[];
		const progressFn = typeof onUpdate === "function"
			? onUpdate as (msg: { content: import("@earendil-works/pi-ai").TextContent[]; details: unknown }) => void
			: undefined;
		return executeGhEditScript(items, progressFn);
	},

	renderCall: (args, theme) => renderGhEditScriptCall(args as { items: GhEditScriptItem[] }, theme),
	renderResult: (result, options, theme) =>
		renderGhEditScriptResult(result as AgentToolResult<GhEditScriptDetails>, options, theme),
});
