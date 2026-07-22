import { resolveInstanceGuid } from "../services/guid-shortener.js";
import { errorMessage } from "../lib/error-message.js";
import type { SubmitResult } from "../infra/command-dispatch.js";

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
	return `${action} error: ${errorMessage(err)}`;
}

export function formatToolFailed(err: unknown): string {
	return `FAILED: ${errorMessage(err)}`;
}
