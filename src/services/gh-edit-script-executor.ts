import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import { submitCommand } from "../infra/command-dispatch.js";
import { withRequester } from "../infra/request-helpers.js";
import { lineCount } from "../lib/line-count.js";
import { fetchScriptCode } from "../tools/canvas-fetch.js";
import { formatToolError } from "../tools/result-formatters.js";
import { resolveInstanceGuid } from "./guid-shortener.js";
import {
	assembleCsharpScript,
	formatCsharpScriptParts,
	parseCsharpScript,
} from "./csharp-script-assembler.js";
import { applyLinePatches, applyPatchesToScript } from "./csharp-script-patcher.js";
import {
	formatCsharpValidationErrors,
	looksLikeGrasshopperCsharpScript,
	validateCsharpScript,
} from "./csharp-script-validator.js";
import {
	sanitizeGhEditScriptItem,
	summarizeGhEditScriptItem,
} from "./gh-edit-script-log.js";
import type { CommandAction } from "../types/commands.js";
import type { CsharpScriptPartsInput, PatchScope } from "../types/csharp-script.js";
import type { GhEditScriptItem, ResolvedGhEditScriptItem } from "../types/gh-edit-script.js";
import type { GhEditScriptDetails } from "../tools/edit-tools/gh-edit-script-render.js";

const CSHARP_ONLY_PATCH_SCOPES = new Set([
	"runScriptBody",
	"runScript",
	"helpers",
	"references",
]);
const REMOVED_PYTHON_PATCH_SCOPES = new Set(["body", "imports"]);

export function isCsharpCode(code: string): boolean {
	return looksLikeGrasshopperCsharpScript(code);
}

export function isCsharpItem(item: GhEditScriptItem): boolean {
	if (item.action === "create") return item.language === "csharp";
	if (item.action === "setCode") {
		return Boolean(item.scriptParts) || looksLikeGrasshopperCsharpScript(item.code ?? "");
	}
	return false;
}

export function defaultPatchScope(code: string): "runScriptBody" | "full" {
	return isCsharpCode(code) ? "runScriptBody" : "full";
}

export function validatePatchScope(code: string, scope: string): string | null {
	if (scope === "full") return null;

	if (isCsharpCode(code)) {
		if (REMOVED_PYTHON_PATCH_SCOPES.has(scope)) {
			return `Patch scope "${scope}" is not supported for C# scripts. Use runScriptBody (default), runScript, helpers, references, or full.`;
		}
		return null;
	}

	if (CSHARP_ONLY_PATCH_SCOPES.has(scope)) {
		return `Patch scope "${scope}" is for C# scripts; this target is Python. Use full (default).`;
	}

	if (REMOVED_PYTHON_PATCH_SCOPES.has(scope)) {
		return `Patch scope "${scope}" is no longer supported for Python. Use full (default); line numbers are 1-based from the top of the script.`;
	}

	return `Patch scope "${scope}" is not supported for Python scripts. Use full (default).`;
}

export function resolveCsharpCode(item: {
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

export function validateScriptItem(item: GhEditScriptItem, resolvedCode?: string): string | null {
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
		return applyPatchesToScript(response.code, item.patches, scope as PatchScope);
	}
	return applyLinePatches(response.code, item.patches);
}

export async function prepareMutationItems(items: GhEditScriptItem[]): Promise<ResolvedGhEditScriptItem[]> {
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

export function mapGhEditScriptMutation(item: ResolvedGhEditScriptItem) {
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

async function executeQueryItem(item: Extract<GhEditScriptItem, { action: "getCode" | "getCodeParts" }>): Promise<string> {
	const response = await withRequester((req) =>
		fetchScriptCode(req, resolveInstanceGuid(item.targetId)),
	);
	if (item.action === "getCode") {
		return response.code;
	}
	if (isCsharpCode(response.code)) {
		const parts = parseCsharpScript(response.code);
		return parts
			? formatCsharpScriptParts(parts)
			: "getCodeParts error: not a parseable C# script.";
	}
	return "getCodeParts error: getCodeParts is for C# scripts; use getCode for Python.";
}

export async function executeGhEditScript(
	items: GhEditScriptItem[],
	onUpdate?: (msg: { content: TextContent[]; details: unknown }) => void,
): Promise<AgentToolResult<GhEditScriptDetails>> {
	const summaries = items.map(summarizeGhEditScriptItem);

	let preparedMutations: ResolvedGhEditScriptItem[] = [];
	try {
		preparedMutations = await prepareMutationItems(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text" as const, text: message }],
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

	const queryActions = new Set(["getCode", "getCodeParts"]);
	const queryItems = items.filter((item) => queryActions.has(item.action));
	const mutationItems = preparedMutations;

	const outcomeResults: string[] = [];
	const results: string[] = [];
	let submittedMutations = 0;
	const mutationFailures: string[] = [];

	for (const item of queryItems) {
		if (item.action !== "getCode" && item.action !== "getCodeParts") continue;
		const summary = summarizeGhEditScriptItem(item);
		onUpdate?.({
			content: [{ type: "text" as const, text: summary }],
			details: { item: sanitizeGhEditScriptItem(item) },
		});
		try {
			const output = await executeQueryItem(item);
			results.push(output);
			outcomeResults.push(`${summary} → ${lineCount(output)} lines`);
		} catch (err) {
			const message = formatToolError(item.action, err);
			results.push(message);
			outcomeResults.push(`${summary} → failed`);
		}
	}

	if (mutationItems.length > 0) {
		for (const item of mutationItems) {
			const summary = summarizeGhEditScriptItem(item);
			onUpdate?.({
				content: [{ type: "text" as const, text: summary }],
				details: { item: sanitizeGhEditScriptItem(item) },
			});

			const mapped = mapGhEditScriptMutation(item);
			if (!mapped) continue;

			try {
				await submitCommand(mapped.action, mapped.params);
				submittedMutations++;
				outcomeResults.push(`${summary} → submitted`);
			} catch (err) {
				const message = formatToolError(item.action, err);
				mutationFailures.push(message);
				outcomeResults.push(`${summary} → failed`);
			}
		}
		results.push(
			`Submitted ${submittedMutations} script mutation${submittedMutations === 1 ? "" : "s"}.`,
		);
		if (mutationFailures.length > 0) {
			results.push(
				`${mutationFailures.length} failure${mutationFailures.length === 1 ? "" : "s"}:`,
				...mutationFailures,
			);
		}
	}

	return {
		content: [{ type: "text" as const, text: results.join("\n") }],
		details: {
			summaries,
			results: outcomeResults,
			items: items.map(sanitizeGhEditScriptItem),
			queryCount: queryItems.length,
			mutationCount: mutationItems.length,
		} satisfies GhEditScriptDetails,
	};
}
