import { formatEndpoint, resolveConnection } from "./connection.js";

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
	return formatEndpoint(resolveConnection().reqEndpoint);
}

export function backendOfflineMessage(): string {
	const endpoint = formatBackendEndpoint();
	return (
		`Grasshopper backend is offline (${endpoint}). ` +
		"Please check that Rhino is running, Grasshopper is open, and the Hopper connection profile/token is current."
	);
}

export class BackendOfflineError extends Error {
	constructor(message = backendOfflineMessage()) {
		super(message);
		this.name = "BackendOfflineError";
	}
}
