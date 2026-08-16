import type { JsonObject, JsonValue, MutationScope } from "../core/contracts.js";
import { HopperCoreError } from "../core/errors.js";
import type { PreparedMutation, ResolvedOperationCall } from "../core/operations.js";
import { cliError, cliResponse, type CliResponse } from "./response.js";
import type { ParsedCommand } from "./args.js";
import type { CliDependencies } from "./handlers.js";
import { loadJsonInput } from "./input.js";
import { handleCall } from "./handlers.js";
import type { InputSource } from "./args.js";

export type BatchItem = {
	operation: string;
	input: JsonValue;
};

function isBatchItem(value: unknown): value is BatchItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return typeof record.operation === "string";
}

function parseBatchDocument(value: unknown): BatchItem[] {
	if (Array.isArray(value)) {
		if (!value.every(isBatchItem)) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "batch input array items must be { operation, input } objects.",
				retryable: false,
			});
		}
		return value;
	}
	if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
		const items = (value as { items: unknown[] }).items;
		if (!items.every(isBatchItem)) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "batch.items must be { operation, input } objects.",
				retryable: false,
			});
		}
		return items;
	}
	throw new HopperCoreError({
		code: "invalid_input",
		message: "batch input must be { items: [...] } or an array of operations.",
		retryable: false,
	});
}

export async function handleBatch(
	command: Extract<ParsedCommand, { kind: "batch" }>,
	deps: CliDependencies,
): Promise<CliResponse> {
	let items: BatchItem[];
	try {
		items = parseBatchDocument(await loadJsonInput(command.input, deps.io));
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError("batch", error.hopperError);
		}
		return cliError("batch", {
			code: "invalid_input",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		});
	}
	if (items.length === 0) {
		return cliError("batch", {
			code: "invalid_input",
			message: "batch requires at least one operation.",
			retryable: false,
		});
	}

	const resolved: ResolvedOperationCall[] = [];
	const prepared: PreparedMutation[] = [];
	const dummyContext = {
		signal: AbortSignal.timeout(30_000),
		requestId: "req_batch_prepare" as const,
		session: null,
		backend: {
			query: async <T extends JsonValue>() => null as T,
			executeActions: async () => ({ outcome: "succeeded" as const, data: null, error: null }),
		},
		artifacts: {
			write: async () => {
				throw new Error("batch preparation must not write artifacts");
			},
		},
		reportProgress: () => {},
		now: () => deps.now(),
	};

	for (const item of items) {
		let call: ResolvedOperationCall;
		try {
			call = deps.registry.resolve(item.operation, item.input ?? {});
		} catch (error) {
			if (error instanceof HopperCoreError) {
				return cliError("batch", error.hopperError, { operation: item.operation });
			}
			return cliError("batch", {
				code: "invalid_input",
				message: error instanceof Error ? error.message : String(error),
				retryable: false,
			}, { operation: item.operation });
		}
		if (call.scope === "none" || call.scope === "viewport") {
			return cliError("batch", {
				code: "operation_not_batchable",
				message: `Operation '${item.operation}' is a read or viewport call and cannot be batched.`,
				retryable: false,
			}, { operation: item.operation });
		}
		if (!call.operation.prepareMutation) {
			return cliError("batch", {
				code: "operation_not_batchable",
				message: `Operation '${item.operation}' does not implement prepareMutation.`,
				retryable: false,
			}, { operation: item.operation });
		}
		try {
			prepared.push(await call.operation.prepareMutation(call.input, dummyContext));
		} catch (error) {
			if (error instanceof HopperCoreError) {
				return cliError("batch", error.hopperError, { operation: item.operation });
			}
			return cliError("batch", {
				code: "operation_not_batchable",
				message: error instanceof Error ? error.message : String(error),
				retryable: false,
			}, { operation: item.operation });
		}
		resolved.push(call);
	}

	const scopes = new Set(prepared.map((entry) => entry.scope));
	if (scopes.size !== 1) {
		return cliError("batch", {
			code: "operation_not_batchable",
			message: "batch items must share one mutation scope; mixed document bindings are rejected.",
			retryable: false,
		});
	}

	const actions = prepared.flatMap((entry) => entry.actions);
	const first = resolved[0]!;
	const registry = Object.create(deps.registry) as CliDependencies["registry"];
	registry.resolve = () => first;
	registry.execute = async (_call, context) => {
		const response = await context.backend.executeActions({
			scope: [...scopes][0] as MutationScope,
			actions,
		}, context.signal);
		const finished = prepared.map((entry) => entry.finish(response));
		const failed = finished.find((result) => result.outcome !== "succeeded");
		return {
			outcome: failed?.outcome ?? "succeeded",
			message: failed
				? `Batch ended with ${failed.outcome}.`
				: `${resolved.length} operations committed in one edit.`,
			data: {
				items: finished.map((result, index) => ({
					operation: resolved[index]!.operation.name,
					outcome: result.outcome,
					data: result.data,
					error: result.error,
				})),
			} as JsonValue,
			warnings: finished.flatMap((result) => result.warnings),
			artifacts: finished.flatMap((result) => result.artifacts),
			error: failed?.error ?? null,
		};
	};
	return handleCall({
		kind: "call",
		operation: first.operation.name,
		sessionId: command.sessionId,
		input: {
			kind: "inline",
			json: JSON.stringify(first.input),
		},
		allowCapture: false,
		json: command.json,
	}, { ...deps, registry });
}

export function summarizeBatch(items: BatchItem[]): JsonObject {
	return { operations: items.map((item) => item.operation) };
}

export type { InputSource };
