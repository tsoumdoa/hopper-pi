import { PROBE_TIMEOUT_MS } from "../config.js";
import { errorMessage } from "../lib/error-message.js";
import type { AuthErrorResponse, PingResponse } from "../types/messages.js";
import { clearConnectionCache } from "./connection.js";
import {
	BackendOfflineError,
	type BackendStatus,
	isBackendKnownOffline,
	setCachedBackendStatus,
} from "./backend-status-cache.js";
import { Requester } from "./requester.js";

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

async function probeRequester(
	requester: import("./requester.js").Requester
): Promise<void> {
	const res = await requester.request<
		PingResponse | AuthErrorResponse | { type?: string }
	>({
		type: "ping",
	});
	if (res.type === "auth.error") {
		const error = "error" in res ? res.error : undefined;
		throw new Error(error || "Invalid connection token");
	}
	if (res.type !== "ping.response") {
		throw new Error(`unexpected response: ${res.type}`);
	}
}

async function withProbeRequester(
	fn: (requester: Requester) => Promise<void>,
	options: { refresh?: boolean } = {}
): Promise<void> {
	const requester = new Requester();
	try {
		await requester.connect(options);
		await fn(requester);
	} finally {
		await requester.close();
	}
}

/** Lightweight REQ/REP probe to see if the Rhino ZMQ backend is reachable. */
export async function probeBackend(): Promise<BackendStatus> {
	let status: BackendStatus;
	try {
		try {
			await probeOnce();
		} catch {
			clearConnectionCache();
			await probeOnce({ refresh: true });
		}
		status = { online: true };
	} catch (err) {
		status = { online: false, error: errorMessage(err) };
	}
	setCachedBackendStatus(status);
	return status;
}

async function probeOnce(options: { refresh?: boolean } = {}): Promise<void> {
	await Promise.race([
		withProbeRequester(probeRequester, options),
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
