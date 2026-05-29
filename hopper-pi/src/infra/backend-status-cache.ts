import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { REQ_ENDPOINT } from "./connection.js";

export type BackendStatus = {
	online: boolean;
	error?: string;
};

let cachedStatus: BackendStatus | null = null;

export function getCachedBackendStatus(): BackendStatus | null {
	return cachedStatus;
}

export function setCachedBackendStatus(status: BackendStatus): void {
	cachedStatus = status;
}

/** True when the last probe reported the backend unreachable. */
export function isBackendKnownOffline(): boolean {
	return cachedStatus !== null && !cachedStatus.online;
}

export function formatBackendEndpoint(): string {
	return REQ_ENDPOINT.replace(/^tcp:\/\//, "");
}

export function backendOfflineMessage(): string {
	const endpoint = formatBackendEndpoint();
	return (
		`Grasshopper backend is offline (${endpoint}). ` +
		"Please check that Rhino is running, Grasshopper is open, and the Hopper connection is active."
	);
}

export function backendOfflineToolResult(): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: backendOfflineMessage() }],
		details: { offline: true },
	};
}

export class BackendOfflineError extends Error {
	constructor(message = backendOfflineMessage()) {
		super(message);
		this.name = "BackendOfflineError";
	}
}
