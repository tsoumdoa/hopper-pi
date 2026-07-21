import { resolveInstanceGuid, toShortInstanceGuid } from "../services/guid-shortener.js";
import type { SubmitResult } from "../infra/command-dispatch.js";

const GUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Replace full GUIDs in a plugin result string with registered short instance IDs. */
export function shortenGuidsInText(text: string): string {
	return text.replace(GUID_PATTERN, (guid) => toShortInstanceGuid(guid));
}

export function formatDefaultResult<T extends { targetId?: string; action: string }>(
	item: T,
	result: SubmitResult,
): string {
	if (result.state === "failed" || result.state === "cancelled") {
		return `${item.action} FAILED: ${shortenGuidsInText(result.error ?? "unknown error")}`;
	}
	if (result.result) {
		return `${item.action} completed → ${shortenGuidsInText(result.result)}`;
	}
	const rawId = item.targetId ?? "N/A";
	return `${item.action} completed. shortId=${rawId} -> resolvedGuid=${resolveInstanceGuid(rawId)}, jobId=${result.jobId}`;
}

export function defaultProgressMsg<T extends { targetId?: string; action: string; componentType?: string }>(
	item: T,
): string {
	return `${item.action} on ${item.targetId ?? item.componentType ?? "unknown"}...`;
}

export function formatToolError(action: string, err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return `${action} error: ${message}`;
}

export function formatToolFailed(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return `FAILED: ${message}`;
}
