import { resolveInstanceGuid } from "../services/guid-shortener.js";
import type { SubmitResult } from "../infra/command-dispatch.js";
import { RpcOutcomeUnknownError } from "../infra/runtime-rpc.js";

export function formatDefaultResult<T extends { targetId?: string; action: string }>(
	item: T,
	result: SubmitResult,
): string {
	const rawId = item.targetId ?? "N/A";
	return `${item.action} completed. shortId=${rawId} -> resolvedGuid=${resolveInstanceGuid(rawId)}, jobId=${result.jobId}`;
}

export function defaultProgressMsg<T extends { targetId?: string; action: string; componentType?: string }>(
	item: T,
): string {
	return `${item.action} on ${item.targetId ?? item.componentType ?? "unknown"}...`;
}

export function formatToolError(action: string, err: unknown): string {
	if (err instanceof RpcOutcomeUnknownError) {
		return `${action} outcome UNKNOWN: ${err.message}`;
	}
	const message = err instanceof Error ? err.message : String(err);
	return `${action} error: ${message}`;
}

export function formatToolFailed(err: unknown): string {
	if (err instanceof RpcOutcomeUnknownError) {
		return `OUTCOME UNKNOWN: ${err.message}`;
	}
	const message = err instanceof Error ? err.message : String(err);
	return `FAILED: ${message}`;
}
