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
