import { PROBE_TIMEOUT_MS } from "../config.js";
import {
	BackendOfflineError,
	type BackendStatus,
	isBackendKnownOffline,
	setCachedBackendStatus,
} from "./backend-status-cache.js";
import { getRuntimeRpc } from "./runtime-rpc.js";
import type { RuntimeStatus } from "../protocol/v2.js";

export type { BackendStatus } from "./backend-status-cache.js";
export {
	BackendOfflineError,
	backendOfflineMessage,
	backendOfflineToolResult,
	formatBackendEndpoint,
	getCachedBackendStatus,
	isBackendKnownOffline,
	setCachedBackendStatus,
} from "./backend-status-cache.js";

/** Read Rhino's authoritative runtime status through RPC v2. */
export async function getRuntimeStatus(): Promise<RuntimeStatus> {
	return getRuntimeRpc().getRuntimeStatus(PROBE_TIMEOUT_MS);
}

export async function probeBackend(): Promise<BackendStatus> {
	let status: BackendStatus;
	try {
		await probeOnce();
		status = { online: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		status = { online: false, error: message };
	}
	setCachedBackendStatus(status);
	return status;
}

async function probeOnce(): Promise<void> {
	await Promise.race([
		getRuntimeStatus(),
		new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)),
				PROBE_TIMEOUT_MS
			);
		}),
	]);
}

/** Re-probe when cached offline so a transient miss does not block tools. */
export async function refreshBackendIfOffline(): Promise<boolean> {
	if (!isBackendKnownOffline()) {
		return true;
	}
	const status = await probeBackend();
	return status.online;
}

/** Throw when the backend is unreachable after an optional refresh probe. */
export async function ensureBackendReachable(): Promise<void> {
	if (!(await refreshBackendIfOffline())) {
		throw new BackendOfflineError();
	}
}
