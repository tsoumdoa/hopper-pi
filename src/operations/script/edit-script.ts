import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type {
	BackendAction,
	ExecuteActionsResponse,
	JsonObject,
	JsonSchema,
	JsonValue,
	OperationOutcome,
	OperationResult,
} from "../../core/contracts.js";
import { HopperCoreError, toHopperError, type HopperError } from "../../core/errors.js";
import {
	defineOperation,
	type OperationContext,
	type PreparedMutation,
} from "../../core/operations.js";
import { lineCount } from "../../lib/line-count.js";
import {
	assembleCsharpScript,
	parseCsharpScript,
} from "../../services/csharp-script-assembler.js";
import {
	applyLinePatches,
	applyPatchesToScript,
} from "../../services/csharp-script-patcher.js";
import {
	formatCsharpValidationErrors,
	looksLikeGrasshopperCsharpScript,
	validateCsharpScript,
} from "../../services/csharp-script-validator.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { PatchScope } from "../../types/csharp-script.js";
import type { GhEditScriptItem } from "../../types/gh-edit-script.js";

export type GhEditScriptInput = { items: GhEditScriptItem[] };

export type ScriptItemResult = {
	index: number;
	action: GhEditScriptItem["action"];
	outcome: "succeeded" | "failed" | "skipped";
	targetId?: string;
	message: string;
	data: JsonValue | null;
	error: HopperError | null;
};

export type GhEditScriptData = { items: ScriptItemResult[] };

const DataMappingType = Type.Union([
	Type.Literal("none"),
	Type.Literal("flatten"),
	Type.Literal("graft"),
], { description: "Data mapping mode" });
const AccessType = Type.Union([
	Type.Literal("item"),
	Type.Literal("list"),
	Type.Literal("tree"),
], { description: "Access type (default: item)" });
const TypeHintType = Type.Union([
	Type.Literal("object"),
	Type.Literal("double"),
	Type.Literal("int"),
	Type.Literal("integer"),
	Type.Literal("string"),
	Type.Literal("bool"),
	Type.Literal("boolean"),
], {
	description:
		"Script param type hint (default: object). Use double for floating-point numbers, int for integers, string for text, bool for booleans.",
});
const ScriptIOFields = Type.Object({
	name: Type.String({ description: "Parameter name" }),
	previousName: Type.Optional(Type.String({
		description:
			"Old port name when renaming (preserves wires). Use when order changes or swapping names.",
	})),
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean({ description: "Simplify data paths" })),
	reverse: Type.Optional(Type.Boolean({ description: "Reverse item order" })),
});
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
	references: Type.Optional(Type.Array(Type.String(), {
		description: "Namespaces without using/semicolon (e.g. System, Rhino.Geometry). Defaults to standard GH set.",
	})),
	runScript: Type.String({
		description: "private void RunScript(...) method only — no class wrapper or using lines",
	}),
	helpers: Type.Optional(Type.String({
		description: "Optional helper methods inside Script_Instance, below RunScript",
	})),
});

function preserveLegacySchemaKeyOrder<T extends object>(schema: T): T {
	for (const value of Object.values(schema)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") preserveLegacySchemaKeyOrder(item);
			}
		} else if (value && typeof value === "object") {
			preserveLegacySchemaKeyOrder(value);
		}
	}
	const record = schema as Record<string, unknown>;
	if (typeof record.type !== "string" && !Array.isArray(record.anyOf)) return schema;
	const preferred = Array.isArray(record.anyOf)
		? ["anyOf", "description"]
		: record.type === "object"
			? ["type", "required", "properties"]
			: record.type === "array"
				? ["type", "prefixItems", "items", "minItems", "maxItems", "description"]
				: ["type", "const", "pattern", "minimum", "maximum", "minLength", "maxLength", "description"];
	const keys = Object.keys(record);
	const ordered = [
		...preferred.filter((key) => keys.includes(key)),
		...keys.filter((key) => !preferred.includes(key)),
	];
	const entries = ordered.map((key) => [key, record[key]] as const);
	for (const key of keys) delete record[key];
	for (const [key, value] of entries) record[key] = value;
	return schema;
}

export const GhEditScriptInputSchema = preserveLegacySchemaKeyOrder(Type.Object({
	items: Type.Array(Type.Union([
		Type.Object({
			action: Type.Literal("create"),
			x: Type.Number({ description: "Canvas X" }),
			y: Type.Number({ description: "Canvas Y" }),
			language: Type.Union([Type.Literal("python"), Type.Literal("csharp")], {
				description: "Script language (immutable after creation)",
			}),
			code: Type.Optional(Type.String({ description: "Full script source (Python or legacy C#)" })),
			scriptParts: Type.Optional(CsharpScriptPartsFields),
			nickName: Type.Optional(Type.String({ description: "Script nickname" })),
			inputs: Type.Optional(Type.Array(ScriptIOFields, {
				description: "Desired input ports (full list for create)",
			})),
			outputs: Type.Optional(Type.Array(ScriptIOFields, {
				description: "Desired output ports (full list for create)",
			})),
		}),
		Type.Object({
			action: Type.Literal("setCode"),
			targetId: Type.String({ description: "Script component GUID" }),
			code: Type.Optional(Type.String({ description: "Full script source" })),
			scriptParts: Type.Optional(CsharpScriptPartsFields),
			inputs: Type.Optional(Type.Array(ScriptIOFields, {
				description:
					"Full desired input list — reconciles ports. Omit to leave unchanged; [] removes all inputs.",
			})),
			outputs: Type.Optional(Type.Array(ScriptIOFields, {
				description:
					"Full desired output list — reconciles ports. Omit to leave unchanged; [] removes all outputs.",
			})),
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
	]), { minItems: 1 }),
})) as JsonSchema<GhEditScriptInput>;

const HopperErrorSchema = Type.Object({
	code: Type.String(),
	message: Type.String(),
	retryable: Type.Boolean(),
	details: Type.Optional(Type.Object({}, { additionalProperties: true })),
});
const ScriptItemResultSchema = Type.Object({
	index: Type.Integer({ minimum: 0 }),
	action: Type.String(),
	outcome: Type.Union([Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("skipped")]),
	targetId: Type.Optional(Type.String()),
	message: Type.String(),
	data: Type.Any(),
	error: Type.Union([HopperErrorSchema, Type.Null()]),
});
export const GhEditScriptOutputSchema = Type.Object({
	items: Type.Array(ScriptItemResultSchema),
}) as JsonSchema<GhEditScriptData>;

const READ_ACTIONS = new Set<GhEditScriptItem["action"]>(["getCode", "getCodeParts"]);
const CSHARP_SCOPES = new Set(["runScriptBody", "runScript", "helpers", "references"]);

function textMetrics(text: string): JsonObject {
	return {
		sha256: createHash("sha256").update(text, "utf8").digest("hex"),
		byteLength: Buffer.byteLength(text, "utf8"),
		lineCount: lineCount(text),
	};
}

function sourceText(item: Extract<GhEditScriptItem, { action: "create" | "setCode" }>): string | null {
	if (item.code !== undefined) return item.code;
	if (item.scriptParts !== undefined) return assembleCsharpScript(item.scriptParts);
	return null;
}

export function summarizeGhEditScriptInput(input: GhEditScriptInput): JsonObject {
	return {
		items: input.items.map((item) => {
			const base: JsonObject = {
				action: item.action,
				...("targetId" in item ? { targetId: item.targetId } : {}),
			};
			if (item.action === "create" || item.action === "setCode") {
				const source = sourceText(item);
				return {
					...base,
					language: item.action === "create"
						? item.language
						: item.scriptParts || looksLikeGrasshopperCsharpScript(item.code ?? "")
							? "csharp"
							: "python",
					...(source === null ? {} : { source: textMetrics(source) }),
				};
			}
			if (item.action === "patchCode") {
				return {
					...base,
					scope: item.scope ?? "default",
					edits: item.patches.map((patch) => ({
						op: patch.op,
						...(patch.op === "insert" ? { afterLine: patch.afterLine } : {
							startLine: patch.startLine,
							endLine: patch.endLine,
						}),
						...(patch.op === "delete" ? {} : {
							source: textMetrics(patch.lines.join("\n")),
						}),
					})),
				};
			}
			return base;
		}),
	};
}

export function classifyGhEditScript(input: GhEditScriptInput) {
	return input.items.every((item) => READ_ACTIONS.has(item.action)) ? "none" as const : "grasshopper" as const;
}

function resolveCode(item: Extract<GhEditScriptItem, { action: "create" | "setCode" }>): string {
	const source = sourceText(item);
	if (source === null) throw new Error(`${item.action} requires code or scriptParts.`);
	if (item.code !== undefined && item.scriptParts !== undefined) {
		throw new Error(`${item.action} accepts code or scriptParts, not both.`);
	}
	if (item.action === "create" && item.language === "python" && item.scriptParts !== undefined) {
		throw new Error("Python create requires code and does not accept scriptParts.");
	}
	return source;
}

function validateResolvedCode(item: GhEditScriptItem, code: string): void {
	if (item.action === "create") {
		if (item.language === "python") return;
	} else if (!looksLikeGrasshopperCsharpScript(code)) {
		return;
	}
	const validation = validateCsharpScript(code, {
		inputNames: "inputs" in item ? item.inputs?.map((port) => port.name) : undefined,
		outputNames: "outputs" in item ? item.outputs?.map((port) => port.name) : undefined,
	});
	if (!validation.valid) throw new Error(formatCsharpValidationErrors(validation.errors));
}

async function queryScriptCode(targetId: string, context: OperationContext): Promise<string> {
	const response = await context.backend.query<JsonObject>({
		type: "getScriptCode",
		targetId: resolveInstanceGuid(targetId),
	}, context.signal);
	if (typeof response.code !== "string") throw new Error("The backend returned invalid script code.");
	return response.code;
}

function patchScope(code: string, requested?: PatchScope): PatchScope {
	const scope = requested ?? (looksLikeGrasshopperCsharpScript(code) ? "runScriptBody" : "full");
	if (looksLikeGrasshopperCsharpScript(code)) return scope;
	if (scope !== "full") throw new Error(`Patch scope "${scope}" is for C# scripts; this target is Python. Use full.`);
	return scope;
}

async function mutationAction(item: GhEditScriptItem, context: OperationContext): Promise<BackendAction> {
	if (item.action === "create") {
		const code = resolveCode(item);
		validateResolvedCode(item, code);
		return { kind: "command", command: { action: "createScriptNode", params: {
			position: { x: item.x, y: item.y },
			language: item.language,
			code,
			nickName: item.nickName,
			inputs: item.inputs,
			outputs: item.outputs,
		} } } as BackendAction;
	}
	if (item.action === "setCode") {
		const code = resolveCode(item);
		validateResolvedCode(item, code);
		return { kind: "command", command: { action: "setScriptCode", params: {
			targetId: resolveInstanceGuid(item.targetId), code, inputs: item.inputs, outputs: item.outputs,
		} } } as BackendAction;
	}
	if (item.action === "patchCode") {
		const current = await queryScriptCode(item.targetId, context);
		const scope = patchScope(current, item.scope);
		const code = looksLikeGrasshopperCsharpScript(current)
			? applyPatchesToScript(current, item.patches, scope)
			: applyLinePatches(current, item.patches);
		validateResolvedCode(item, code);
		return { kind: "command", command: { action: "setScriptCode", params: {
			targetId: resolveInstanceGuid(item.targetId), code, inputs: item.inputs, outputs: item.outputs,
		} } } as BackendAction;
	}
	throw new Error(`${item.action} is not a mutation.`);
}

function targetId(item: GhEditScriptItem): string | undefined {
	return "targetId" in item ? item.targetId : undefined;
}

function failedItem(index: number, item: GhEditScriptItem, error: unknown): ScriptItemResult {
	const hopperError = toHopperError(error);
	return {
		index,
		action: item.action,
		outcome: "failed",
		targetId: targetId(item),
		message: hopperError.message,
		data: null,
		error: hopperError,
	};
}

async function executeRead(index: number, item: Extract<GhEditScriptItem, { action: "getCode" | "getCodeParts" }>, context: OperationContext): Promise<ScriptItemResult> {
	const code = await queryScriptCode(item.targetId, context);
	if (item.action === "getCode") {
		return { index, action: item.action, outcome: "succeeded", targetId: item.targetId,
			message: `Read ${lineCount(code)} script line(s).`, data: { code }, error: null };
	}
	const parts = parseCsharpScript(code);
	if (!parts) throw new Error("getCodeParts requires a parseable C# script; use getCode for Python.");
	return { index, action: item.action, outcome: "succeeded", targetId: item.targetId,
		message: "Parsed the C# script into structured parts.", data: JSON.parse(JSON.stringify(parts)), error: null };
}

function itemFromMutationResponse(
	index: number,
	item: GhEditScriptItem,
	response: ExecuteActionsResponse,
	actionIndex = index,
): ScriptItemResult {
	const envelope = response.data && typeof response.data === "object" && !Array.isArray(response.data)
		? response.data
		: null;
	const action = envelope && Array.isArray(envelope.actions) ? envelope.actions[actionIndex] : null;
	const actionRecord = action && typeof action === "object" && !Array.isArray(action) ? action : null;
	const actionOutcome = actionRecord?.outcome;
	const succeeded = actionOutcome === "succeeded"
		|| (actionOutcome === undefined && response.outcome === "succeeded");
	return {
		index,
		action: item.action,
		outcome: succeeded ? "succeeded"
			: actionOutcome === "skipped" || actionOutcome === "unknown" || response.outcome === "unknown"
				? "skipped" : "failed",
		targetId: targetId(item),
		message: succeeded ? (actionRecord?.message as string | undefined) ?? `${item.action} completed.`
			: (actionRecord?.message as string | undefined) ?? response.error?.message ?? `${item.action} failed.`,
		data: actionRecord?.data ?? null,
		error: succeeded ? null : (actionRecord?.error as HopperError | null | undefined) ?? response.error ?? {
			code: response.outcome === "unknown" ? "outcome_unknown" : "operation_failed",
			message: `${item.action} ended with outcome ${response.outcome}.`,
			retryable: response.outcome === "unknown",
		},
	};
}

function finishResult(
	items: ScriptItemResult[],
	mutationCount: number,
	forcedOutcome?: OperationOutcome,
	canvasDigestAfter?: string | null,
): OperationResult<GhEditScriptData> {
	if (forcedOutcome === "unknown") {
		const error: HopperError = {
			code: "outcome_unknown",
			message: "The backend could not prove whether the script mutation completed.",
			retryable: true,
		};
		return { outcome: "unknown", message: error.message, data: { items }, execution: { canvasDigestAfter: canvasDigestAfter ?? null }, warnings: [], artifacts: [], error };
	}
	const failures = items.filter((item) => item.outcome === "failed");
	if (failures.length === 0) {
		return { outcome: "succeeded", message: `Completed ${items.length} script item(s).`, data: { items }, execution: { canvasDigestAfter: canvasDigestAfter ?? null }, warnings: [], artifacts: [], error: null };
	}
	const successes = items.length - failures.length;
	const outcome: OperationOutcome = successes > 0 ? "partial" : "failed";
	const error: HopperError = {
		code: successes > 0 && mutationCount > 0 ? "partial_mutation" : "operation_failed",
		message: `${failures.length} of ${items.length} script item(s) failed.`,
		retryable: failures.some((item) => item.error?.retryable === true),
	};
	return { outcome, message: error.message, data: { items }, execution: { canvasDigestAfter: canvasDigestAfter ?? null }, warnings: [], artifacts: [], error };
}

export async function prepareGhEditScriptMutation(
	input: GhEditScriptInput,
	context: OperationContext,
): Promise<PreparedMutation<GhEditScriptData>> {
	if (input.items.some((item) => READ_ACTIONS.has(item.action))) {
		throw new HopperCoreError({
			code: "operation_not_batchable",
			message: "gh_edit_script batches may contain mutation actions only.",
			retryable: false,
		});
	}
	const actions: BackendAction[] = [];
	for (const item of input.items) actions.push(await mutationAction(item, context));
	return {
		scope: "grasshopper",
		actions,
		finish(response) {
			const results = input.items.map((item, index) => itemFromMutationResponse(index, item, response));
			return finishResult(results, input.items.length, response.outcome, response.canvasDigestAfter);
		},
	};
}

export const ghEditScriptOperation = defineOperation<GhEditScriptInput, GhEditScriptData>({
	name: "gh_edit_script",
	version: 1,
	description: "Create, inspect, replace, or patch Grasshopper C# and Python script components.",
	group: "gh-script",
	possibleScopes: ["none", "grasshopper"],
	inputSchema: GhEditScriptInputSchema,
	outputSchema: GhEditScriptOutputSchema,
	classifyScope: classifyGhEditScript,
	summarizeInput: summarizeGhEditScriptInput,
	prepareMutation: prepareGhEditScriptMutation,
	async execute(input, context) {
		if (input.items.every((item) => !READ_ACTIONS.has(item.action))) {
			context.reportProgress({
				phase: "execute",
				message: `Preparing ${input.items.length} script mutation(s).`,
				completed: 0,
				total: input.items.length,
			});
			const prepared = await prepareGhEditScriptMutation(input, context);
			const response = await context.backend.executeActions({
				scope: prepared.scope,
				actions: prepared.actions,
			}, context.signal);
			return prepared.finish(response);
		}

		const results: ScriptItemResult[] = [];
		const mutations: Array<{ index: number; item: GhEditScriptItem; action: BackendAction }> = [];
		for (const [index, item] of input.items.entries()) {
			context.reportProgress({
				phase: READ_ACTIONS.has(item.action) ? "query" : "execute",
				message: `${item.action} script item ${index + 1} of ${input.items.length}.`,
				completed: index,
				total: input.items.length,
			});
			try {
				if (item.action === "getCode" || item.action === "getCodeParts") {
					results.push(await executeRead(index, item, context));
					continue;
				}
				mutations.push({ index, item, action: await mutationAction(item, context) });
			} catch (error) {
				results.push(failedItem(index, item, error));
			}
		}
		if (results.some((item) => item.outcome === "failed")) {
			for (const mutation of mutations) {
				results.push({
					index: mutation.index,
					action: mutation.item.action,
					outcome: "skipped",
					targetId: targetId(mutation.item),
					message: "Skipped because mixed-call preparation failed before mutation execution.",
					data: null,
					error: null,
				});
			}
			results.sort((left, right) => left.index - right.index);
			return finishResult(results, mutations.length);
		}
		const response = await context.backend.executeActions({
			scope: "grasshopper",
			actions: mutations.map((mutation) => mutation.action),
		}, context.signal);
		for (const [actionIndex, mutation] of mutations.entries()) {
			results.push(itemFromMutationResponse(mutation.index, mutation.item, response, actionIndex));
		}
		results.sort((left, right) => left.index - right.index);
		return finishResult(results, mutations.length, response.outcome, response.canvasDigestAfter);
	},
});
