import type {
	BackendAction,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
	OperationResult,
} from "../../core/contracts.js";
import { HopperCoreError, type HopperError } from "../../core/errors.js";
import type { OperationContext, PreparedMutation } from "../../core/operations.js";
import {
	commandAction,
	finishItemMutation,
	type ActionDescriptor,
	type ItemOperationData,
} from "../edit/shared.js";

export type PlannedMutation = {
	originalIndex: number;
	publicAction: string;
	targetId?: string;
	action: BackendAction;
	descriptor: ActionDescriptor;
};

export function commandMutation(
	originalIndex: number,
	publicAction: string,
	command: string,
	params: JsonObject,
	targetId?: string,
): PlannedMutation {
	return {
		originalIndex,
		publicAction,
		...(targetId ? { targetId } : {}),
		action: commandAction(command, params),
		descriptor: { action: command, ...(targetId ? { targetId } : {}) },
	};
}

function fallbackError(response: ExecuteActionsResponse): HopperError | null {
	if (response.outcome === "succeeded") return null;
	if (response.error) return response.error;
	return {
		code: response.outcome === "partial"
			? "partial_mutation"
			: response.outcome === "unknown"
				? "outcome_unknown"
				: "operation_failed",
		message: `Backend mutation ${response.outcome}.`,
		retryable: response.outcome === "unknown",
	};
}

export function finishPlannedMutations(
	response: ExecuteActionsResponse,
	planned: readonly PlannedMutation[],
): OperationResult<ItemOperationData> {
	const base = finishItemMutation(response, planned.map((item) => item.descriptor));
	if (base.data === null) return base;
	const items = (base.data?.items ?? []).map((item, mutationIndex) => {
		const plan = planned[mutationIndex];
		if (!plan) return item;
		return {
			...item,
			index: plan.originalIndex,
			action: plan.publicAction,
			...(plan.targetId ? { targetId: plan.targetId } : {}),
		};
	});
	return { ...base, data: { items } };
}

export function preparedHybridMutation(
	planned: PlannedMutation[],
): PreparedMutation<ItemOperationData> {
	return {
		scope: "grasshopper",
		actions: planned.map((item) => item.action),
		finish: (response) => finishPlannedMutations(response, planned),
	};
}

export function rejectReadItems(operation: string): never {
	throw new HopperCoreError({
		code: "operation_not_batchable",
		message: `${operation} can be prepared for a batch only when every item is a mutation.`,
		retryable: false,
		details: { operation },
	});
}

export function rejectEmptyItems(operation: string): never {
	throw new HopperCoreError({
		code: "invalid_input",
		message: `${operation} requires at least one item.`,
		retryable: false,
		details: { operation, issues: [{ path: "/items", message: "Expected at least one item." }] },
	});
}

export function readItemResult(
	index: number,
	action: string,
	targetId: string,
	data: JsonValue,
	message: string,
) {
	return {
		index,
		action,
		outcome: "succeeded" as const,
		targetId,
		message,
		data,
		error: null,
	};
}

export function failedReadItem(
	index: number,
	action: string,
	targetId: string,
	error: unknown,
) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		index,
		action,
		outcome: "failed" as const,
		targetId,
		message,
		data: null,
		error: {
			code: "operation_failed" as const,
			message,
			retryable: false,
		},
	};
}

export type HybridReadPlan = {
	originalIndex: number;
	publicAction: string;
	targetId?: string;
	execute(): Promise<ItemOperationData["items"][number]>;
};

function skippedItem(
	index: number,
	action: string,
	targetId: string | undefined,
	reason: string,
): ItemOperationData["items"][number] {
	return {
		index,
		action,
		outcome: "skipped",
		...(targetId ? { targetId } : {}),
		message: reason,
		data: null,
		error: null,
	};
}

function terminalResult(
	outcome: "failed" | "partial" | "unknown",
	error: HopperError,
	items: ItemOperationData["items"],
): OperationResult<ItemOperationData> {
	return {
		outcome,
		message: error.message,
		data: { items },
		warnings: [],
		artifacts: [],
		error,
	};
}

/** Mixed calls complete their reads before sending one atomic mutation request.
 * Reads cannot depend on mutations in the same input. This keeps one session
 * edit mapped to one durable backend request. */
export async function executeHybridInOrder(
	context: OperationContext,
	_itemCount: number,
	readPlans: readonly HybridReadPlan[],
	plannedMutations: readonly PlannedMutation[],
): Promise<OperationResult<ItemOperationData>> {
	const readResults: ItemOperationData["items"] = [];
	for (const plan of [...readPlans].sort((left, right) => left.originalIndex - right.originalIndex)) {
		const result = await plan.execute();
		readResults.push(result);
		if (result.outcome !== "failed") continue;
		const items = [
			...readResults,
			...plannedMutations.map((mutation) => skippedItem(
				mutation.originalIndex,
				mutation.publicAction,
				mutation.targetId,
				"Skipped because a read failed before mutation execution.",
			)),
		].sort((left, right) => left.index - right.index);
		return terminalResult(
			"failed",
			(result.error as HopperError | null) ?? {
				code: "operation_failed",
				message: result.message,
				retryable: false,
			},
			items,
		);
	}
	return executeMixed(context, readResults, [...plannedMutations]);
}

export async function executeMixed(
	context: OperationContext,
	readResults: ItemOperationData["items"],
	planned: PlannedMutation[],
): Promise<OperationResult<ItemOperationData>> {
	let mutationResult: OperationResult<ItemOperationData> | null = null;
	if (planned.length > 0) {
		const prepared = preparedHybridMutation(planned);
		const response = await context.backend.executeActions(
			{ actions: prepared.actions },
			context.signal,
		);
		mutationResult = prepared.finish(response);
		if (mutationResult.outcome === "unknown" && mutationResult.data === null) {
			mutationResult = {
				...mutationResult,
				data: {
					items: planned.map((mutation) => skippedItem(
						mutation.originalIndex,
						mutation.publicAction,
						mutation.targetId,
						"Mutation outcome unknown; no terminal action result is available.",
					)),
				},
			};
		}
	}

	const items = [
		...readResults,
		...(mutationResult?.data?.items ?? []),
	].sort((left, right) => left.index - right.index);
	const readFailure = readResults.find((item) => item.outcome === "failed");
	if (mutationResult && mutationResult.outcome !== "succeeded") {
		return { ...mutationResult, data: { items } };
	}
	if (readFailure) {
		return {
			outcome: "failed",
			message: readFailure.message,
			data: { items },
			warnings: [],
			artifacts: [],
			error: (readFailure.error as HopperError | null) ??
				fallbackError({ outcome: "failed", data: null, error: null }),
		};
	}
	return {
		outcome: "succeeded",
		message: `${items.length} item${items.length === 1 ? "" : "s"} succeeded.`,
		data: { items },
		...(mutationResult?.execution ? { execution: mutationResult.execution } : {}),
		warnings: [],
		artifacts: [],
		error: null,
	};
}
