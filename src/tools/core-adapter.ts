import type { OperationFailure, OperationResult } from "../core/contracts.js";
import { PROTOTYPE_OPERATIONS } from "../core/operations.js";

export function prototypeOperation(name: string) {
	const operation = PROTOTYPE_OPERATIONS.find((candidate) => candidate.name === name);
	if (!operation) throw new Error(`Prototype operation is not registered: ${name}`);
	return operation;
}

export function formatCoreFailure(result: OperationFailure): string {
	const prefix = result.outcome === "unknown" ? "UNKNOWN" : "FAILED";
	return `${prefix}: ${result.message}`;
}

export function operationDetails(result: OperationResult): Record<string, unknown> {
	return result as unknown as Record<string, unknown>;
}

export function operationSignal(signal?: AbortSignal): AbortSignal {
	return signal ?? new AbortController().signal;
}
