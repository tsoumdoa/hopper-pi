import { submitCommand } from "../infra/command-dispatch.js";
import { withRequester } from "../infra/request-helpers.js";
import { fetchScriptCode } from "../infra/canvas-fetch.js";
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
import type { CommandAction } from "../types/commands.js";
import type { CsharpScriptPartsInput, PatchScope } from "../types/csharp-script.js";
import type { GhEditScriptItem, ResolvedGhEditScriptItem } from "../types/gh-edit-script.js";

export type GhEditScriptOutcome =
	| { kind: "query"; item: GhEditScriptItem; output: string }
	| { kind: "queryError"; item: GhEditScriptItem; error: unknown }
	| { kind: "mutation"; item: GhEditScriptItem; jobId: string };

export type GhEditScriptExecution = {
	items: GhEditScriptItem[];
	outcomes: GhEditScriptOutcome[];
	queryCount: number;
	mutationCount: number;
	error?: string;
	validationErrors?: string[];
};

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
	onUpdate?: (item: GhEditScriptItem) => void,
): Promise<GhEditScriptExecution> {
	let preparedMutations: ResolvedGhEditScriptItem[] = [];
	try {
		preparedMutations = await prepareMutationItems(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { items, outcomes: [], queryCount: 0, mutationCount: 0, error: message };
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
		return { items, outcomes: [], queryCount: 0, mutationCount: 0, validationErrors };
	}

	const queryActions = new Set(["getCode", "getCodeParts"]);
	const queryItems = items.filter((item) => queryActions.has(item.action));
	const mutationItems = preparedMutations;

	const outcomes: GhEditScriptOutcome[] = [];

	for (const item of queryItems) {
		if (item.action !== "getCode" && item.action !== "getCodeParts") continue;
		onUpdate?.(item);
		try {
			outcomes.push({ kind: "query", item, output: await executeQueryItem(item) });
		} catch (error) {
			outcomes.push({ kind: "queryError", item, error });
		}
	}

	for (const item of mutationItems) {
		onUpdate?.(item);
		const mapped = mapGhEditScriptMutation(item);
		if (!mapped) continue;
		const job = await submitCommand(mapped.action, mapped.params);
		outcomes.push({ kind: "mutation", item, jobId: job.jobId });
	}

	return { items, outcomes, queryCount: queryItems.length, mutationCount: mutationItems.length };
}
