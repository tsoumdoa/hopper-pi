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
], {
	description:
		"Patch target. C# default runScriptBody (scopes: runScriptBody/runScript/helpers/references). Python uses full only (default). full patches the entire script for both.",
});

const LinePatchType = Type.Union([
	Type.Object({
		op: Type.Literal("insert"),
		afterLine: Type.Number({ description: "0 inserts before first line; N inserts after line N" }),
		lines: Type.Array(Type.String()),
	}),
	Type.Object({
		op: Type.Literal("replace"),
		startLine: Type.Number({ description: "1-based inclusive start line in scope" }),
		endLine: Type.Number({ description: "1-based inclusive end line in scope" }),
		lines: Type.Array(Type.String()),
	}),
	Type.Object({
		op: Type.Literal("delete"),
		startLine: Type.Number({ description: "1-based inclusive start line in scope" }),
		endLine: Type.Number({ description: "1-based inclusive end line in scope" }),
	}),
]);

const CsharpScriptPartsFields = Type.Object({
	references: Type.Optional(
		Type.Array(Type.String(), {
			description: "Namespaces without using/semicolon (e.g. System, Rhino.Geometry). Defaults to standard GH set.",
		}),
	),
	runScript: Type.String({
		description: "private void RunScript(...) method only — no class wrapper or using lines",
	}),
	helpers: Type.Optional(
		Type.String({
			description: "Optional helper methods inside Script_Instance, below RunScript",
		}),
	),
});

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"Create, inspect, or edit Grasshopper C#/Python script components (create, setCode, patchCode, getCode, getCodeParts). " +
		"Prefer C# scriptParts; Python uses full code. Include full inputs/outputs when code and port signatures must change together. " +
		"Workflow details: mds/reference/script-component-lifecycle.md.",
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
					code: Type.Optional(Type.String({ description: "Full script source (Python or legacy C#)" })),
					scriptParts: Type.Optional(CsharpScriptPartsFields),
					nickName: Type.Optional(
						Type.String({ description: "Script nickname" }),
					),
					inputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description: "Desired input ports (full list for create)",
						}),
					),
					outputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description: "Desired output ports (full list for create)",
						}),
					),
				}),
				Type.Object({
					action: Type.Literal("setCode"),
					targetId: Type.String({ description: "Script component GUID" }),
					code: Type.Optional(Type.String({ description: "Full script source" })),
					scriptParts: Type.Optional(CsharpScriptPartsFields),
					inputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired input list — reconciles ports. Omit to leave unchanged; [] removes all inputs.",
						}),
					),
					outputs: Type.Optional(
						Type.Array(ScriptIOFields, {
							description:
								"Full desired output list — reconciles ports. Omit to leave unchanged; [] removes all outputs.",
						}),
					),
				}),
				Type.Object({
					action: Type.Literal("patchCode"),
					targetId: Type.String({ description: "Script component GUID" }),
					patches: Type.Array(LinePatchType, { minItems: 1 }),
					scope: Type.Optional(PatchScopeType),
					inputs: Type.Optional(Type.Array(ScriptIOFields)),
					outputs: Type.Optional(Type.Array(ScriptIOFields)),
				}),
				Type.Object({
					action: Type.Literal("getCode"),
					targetId: Type.String({ description: "Script component GUID" }),
				}),
				Type.Object({
					action: Type.Literal("getCodeParts"),
					targetId: Type.String({ description: "Script component GUID" }),
				}),
			]),
			{ minItems: 1 },
		),
	}),
	execute: async (_toolCallId, params, _signal, onUpdate) => {
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
