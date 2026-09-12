import { getRuntimeSessionContext } from "./runtime-session-context.js";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { formatEndpoint, resolveConnection } from "./connection.js";

export type BackendStatus = {
	online: boolean;
	error?: string;
};

const backendStatusKey = Symbol("backendStatus");
function backendState() {
	return getRuntimeSessionContext().get(backendStatusKey, () => ({ status: null as BackendStatus | null }));
}

export function getCachedBackendStatus(): BackendStatus | null {
	return backendState().status;
}

export function setCachedBackendStatus(status: BackendStatus): void {
	backendState().status = status;
}

/** True when the last probe reported the backend unreachable. */
export function isBackendKnownOffline(): boolean {
	const status = backendState().status;
	return status !== null && !status.online;
}

export function formatBackendEndpoint(): string {
	try {
		return formatEndpoint(resolveConnection().rpcEndpoint);
	} catch {
		return "RPC v2 profile unavailable";
	}
}

export function backendOfflineMessage(): string {
	const endpoint = formatBackendEndpoint();
	return (
		`Hopper/Rhino runtime is offline (${endpoint}). ` +
		"Please check that Rhino and HopperCode are running and that the connection profile is current."
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
