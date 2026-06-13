import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import { formatDefaultResult, submitCommand } from "../edit-handlers.js";
import { withRequester } from "../../infra/request-helpers.js";
import { backendOfflineToolResult } from "../../infra/backend-status-cache.js";
import { refreshBackendIfOffline } from "../../infra/backend-status.js";
import { fetchScriptCode } from "../query-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	assembleCsharpScript,
	formatCsharpScriptParts,
	parseCsharpScript,
} from "../../services/csharp-script-assembler.js";
import { applyPatchesToScript } from "../../services/csharp-script-patcher.js";
import {
	formatCsharpValidationErrors,
	looksLikeGrasshopperCsharpScript,
	validateCsharpScript,
} from "../../services/csharp-script-validator.js";
import {
	formatPythonScriptParts,
	parsePythonScript,
} from "../../services/python-script-assembler.js";
import { applyPatchesToPythonScript } from "../../services/python-script-patcher.js";
import { ScriptIOFields } from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";
import type { CsharpScriptPartsInput } from "../../types/csharp-script.js";
import {
	logGhEditScriptCall,
	logGhEditScriptStep,
	sanitizeGhEditScriptItem,
	summarizeGhEditScriptItem,
} from "../../services/gh-edit-script-log.js";
import {
	renderGhEditScriptCall,
	renderGhEditScriptResult,
	type GhEditScriptDetails,
} from "./gh-edit-script-render.js";
import type { GhEditScriptItem, ResolvedGhEditScriptItem } from "../../types/gh-edit-script.js";

const PatchScopeType = Type.Union([
	Type.Literal("runScriptBody"),
	Type.Literal("runScript"),
	Type.Literal("helpers"),
	Type.Literal("references"),
	Type.Literal("body"),
	Type.Literal("imports"),
	Type.Literal("full"),
], {
	description:
		"Patch target. C# default runScriptBody; Python default body. Scopes: C# runScriptBody/runScript/helpers/references; Python body/imports; full works for both.",
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

function isCsharpCode(code: string): boolean {
	return looksLikeGrasshopperCsharpScript(code);
}

function isCsharpItem(item: GhEditScriptItem): boolean {
	if (item.action === "create") return item.language === "csharp";
	if (item.action === "setCode") {
		return Boolean(item.scriptParts) || looksLikeGrasshopperCsharpScript(item.code ?? "");
	}
	return false;
}

function defaultPatchScope(code: string): "runScriptBody" | "body" {
	return isCsharpCode(code) ? "runScriptBody" : "body";
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

const CSHARP_ONLY_PATCH_SCOPES = new Set([
	"runScriptBody",
	"runScript",
	"helpers",
	"references",
]);
const PYTHON_ONLY_PATCH_SCOPES = new Set(["body", "imports"]);

function validatePatchScope(code: string, scope: string): string | null {
	if (scope === "full") return null;

	if (isCsharpCode(code)) {
		if (PYTHON_ONLY_PATCH_SCOPES.has(scope)) {
			return `Patch scope "${scope}" is for Python scripts; this target is C#. Use runScriptBody (default), runScript, helpers, references, or full.`;
		}
		return null;
	}

	if (CSHARP_ONLY_PATCH_SCOPES.has(scope)) {
		return `Patch scope "${scope}" is for C# scripts; this target is Python. Use body (default), imports, or full.`;
	}

	return null;
}

function resolveCsharpCode(item: {
	code?: string;
	scriptParts?: CsharpScriptPartsInput;
}): string {
	if (item.scriptParts) {
		return assembleCsharpScript(item.scriptParts);
	}
	if (item.code) {
		return item.code;
	}
	throw new Error("Provide either code or scriptParts.");
}

function validateScriptItem(item: GhEditScriptItem, resolvedCode?: string): string | null {
	if (item.action === "getCode" || item.action === "getCodeParts") return null;

	if (item.action === "create" && item.language === "python") {
		if (!item.code) return "Python create requires code.";
		return null;
	}

	if (item.action === "create" || item.action === "setCode") {
		if (!item.code && !item.scriptParts) {
			return `${item.action} requires code or scriptParts.`;
		}
		if (item.code && item.scriptParts) {
			return `${item.action} accepts code or scriptParts, not both.`;
		}
	}

	if (item.action === "patchCode") {
		if (!resolvedCode) return null;
		if (!looksLikeGrasshopperCsharpScript(resolvedCode)) return null;
		const result = validateCsharpScript(resolvedCode, {
			inputNames: item.inputs?.map((i) => i.name),
			outputNames: item.outputs?.map((o) => o.name),
		});
		if (result.valid) return null;
		return formatCsharpValidationErrors(result.errors);
	}

	if (!isCsharpItem(item)) return null;

	let code: string;
	try {
		code = resolveCsharpCode(item);
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}

	const result = validateCsharpScript(code, {
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

async function resolvePatchCode(item: Extract<GhEditScriptItem, { action: "patchCode" }>): Promise<string> {
	const response = await withRequester((req) =>
		fetchScriptCode(req, resolveInstanceGuid(item.targetId)),
	);
	const scope = item.scope ?? defaultPatchScope(response.code);
	const scopeError = validatePatchScope(response.code, scope);
	if (scopeError) {
		throw new Error(scopeError);
	}
	if (isCsharpCode(response.code)) {
		return applyPatchesToScript(response.code, item.patches, scope as "runScriptBody");
	}
	return applyPatchesToPythonScript(response.code, item.patches, scope as "body");
}

async function prepareMutationItems(items: GhEditScriptItem[]): Promise<ResolvedGhEditScriptItem[]> {
	const prepared: ResolvedGhEditScriptItem[] = [];

	for (const item of items) {
		if (item.action === "getCode" || item.action === "getCodeParts") continue;

		if (item.action === "patchCode") {
			prepared.push({
				...item,
				resolvedCode: await resolvePatchCode(item),
			});
			continue;
		}

		prepared.push(item);
	}

	return prepared;
}

function mapMutation(item: ResolvedGhEditScriptItem) {
	switch (item.action) {
		case "create":
			return {
				action: "createScriptNode" as CommandAction,
				params: {
					position: { x: item.x, y: item.y },
					language: item.language,
					code: item.language === "csharp"
						? resolveCsharpCode(item)
						: item.code ?? "",
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
					code: isCsharpItem(item) ? resolveCsharpCode(item) : item.code ?? "",
					inputs: item.inputs,
					outputs: item.outputs,
				},
			};
		case "patchCode":
			return {
				action: "setScriptCode" as CommandAction,
				params: {
					targetId: resolveInstanceGuid(item.targetId),
					code: item.resolvedCode ?? "",
					inputs: item.inputs,
					outputs: item.outputs,
				},
			};
	}
}

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"C#/Python script nodes. C#: prefer scriptParts (references + RunScript — wrapper assembled server-side). Python: use full code (no wrapper). Both: patchCode for line edits (C# default scope runScriptBody, Python body). getCodeParts returns structured parts with lineMap.",
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
					patches: Type.Array(LinePatchType),
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
		),
	}),
	execute: async (toolCallId, params, _signal, onUpdate) => {
		const items = params.items as GhEditScriptItem[];
		const summaries = items.map(summarizeGhEditScriptItem);
		logGhEditScriptCall(toolCallId, items);

		let preparedMutations: ResolvedGhEditScriptItem[] = [];
		try {
			preparedMutations = await prepareMutationItems(items);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logGhEditScriptStep(`prepare failed: ${message}`);
			return {
				content: [{
					type: "text" as const,
					text: message,
				}],
				details: {
					summaries,
					results: [`prepare failed: ${message}`],
					items: items.map(sanitizeGhEditScriptItem),
					queryCount: 0,
					mutationCount: 0,
					error: message,
				} satisfies GhEditScriptDetails,
			};
		}

		const validationErrors = items
			.map((item) => {
				if (item.action === "patchCode") {
					const prepared = preparedMutations.find(
						(m) => m.action === "patchCode" && m.targetId === item.targetId,
					);
					return validateScriptItem(item, prepared?.resolvedCode);
				}
				return validateScriptItem(item);
			})
			.filter((msg): msg is string => msg != null);

		if (validationErrors.length > 0) {
			logGhEditScriptStep(`validation failed: ${validationErrors.join(" | ")}`);
			return {
				content: [{ type: "text" as const, text: validationErrors.join("\n\n") }],
				details: {
					summaries,
					results: validationErrors.map((e) => `validation: ${e}`),
					items: items.map(sanitizeGhEditScriptItem),
					queryCount: 0,
					mutationCount: 0,
					validationErrors,
				} satisfies GhEditScriptDetails,
			};
		}

		if (!(await refreshBackendIfOffline())) {
			return backendOfflineToolResult();
		}

		const queryActions = new Set(["getCode", "getCodeParts"]);
		const queryItems = items.filter((item) => queryActions.has(item.action));
		const mutationItems = preparedMutations;

		const progressFn = typeof onUpdate === "function"
			? (onUpdate as (msg: { content: TextContent[]; details: unknown }) => void)
			: undefined;

		const outcomeResults: string[] = [];
		const results: string[] = [];

		for (const item of queryItems) {
			if (item.action !== "getCode" && item.action !== "getCodeParts") continue;
			const summary = summarizeGhEditScriptItem(item);
			logGhEditScriptStep(`executing ${summary}`);
			if (progressFn) {
				progressFn({
					content: [{
						type: "text" as const,
						text: summary,
					}],
					details: { item: sanitizeGhEditScriptItem(item) },
				});
			}
			try {
				const response = await withRequester((req) =>
					fetchScriptCode(req, resolveInstanceGuid(item.targetId)),
				);
				if (item.action === "getCode") {
					results.push(response.code);
					outcomeResults.push(`${summary} → ${lineCount(response.code)} lines`);
				} else if (isCsharpCode(response.code)) {
					const parts = parseCsharpScript(response.code);
					const formatted = parts
						? formatCsharpScriptParts(parts)
						: "getCodeParts error: not a parseable C# script.";
					results.push(formatted);
					outcomeResults.push(`${summary} → ${lineCount(formatted)} lines`);
				} else {
					const formatted = formatPythonScriptParts(parsePythonScript(response.code));
					results.push(formatted);
					outcomeResults.push(`${summary} → ${lineCount(formatted)} lines`);
				}
			} catch (err) {
				const message = `${item.action} error: ${err}`;
				results.push(message);
				outcomeResults.push(`${summary} → failed`);
			}
		}

		if (mutationItems.length > 0) {
			for (const item of mutationItems) {
				const summary = summarizeGhEditScriptItem(item);
				logGhEditScriptStep(`executing ${summary}`);
				if (progressFn) {
					progressFn({
						content: [{ type: "text" as const, text: summary }],
						details: { item: sanitizeGhEditScriptItem(item) },
					});
				}

				const mapped = mapMutation(item);
				if (!mapped) continue;

				const job = await submitCommand(mapped.action, mapped.params);
				const outcome = `${summary} → ${job.jobId}`;
				outcomeResults.push(outcome);
				results.push(formatDefaultResult(
					{ action: item.action, targetId: "targetId" in item ? item.targetId : undefined },
					job,
				));
			}
		}

		logGhEditScriptStep(`done (${queryItems.length} queries, ${mutationItems.length} mutations)`);

		const details: GhEditScriptDetails = {
			summaries,
			results: outcomeResults,
			items: items.map(sanitizeGhEditScriptItem),
			queryCount: queryItems.length,
			mutationCount: mutationItems.length,
		};

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details,
		} satisfies AgentToolResult<GhEditScriptDetails>;
	},

	renderCall: (args, theme) => renderGhEditScriptCall(args as { items: GhEditScriptItem[] }, theme),
	renderResult: (result, options, theme) =>
		renderGhEditScriptResult(result as AgentToolResult<GhEditScriptDetails>, options, theme),
});
