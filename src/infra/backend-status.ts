import type { PingResponse } from "../types/messages.js";
import {
	type BackendStatus,
	getCachedBackendStatus,
	setCachedBackendStatus,
} from "./backend-status-cache.js";
import { Requester } from "./requester.js";

/** Allow time for Rhino.Inside.Revit to wake dormant Grasshopper on ping. */
const PROBE_TIMEOUT_MS = 10_000;
const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 3;

let consecutiveProbeFailures = 0;

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
	const res = await requester.request<PingResponse>({
		type: "ping",
	});
	if (res.type !== "ping.response") {
		throw new Error(`unexpected response: ${res.type}`);
	}
}

async function withProbeRequester(
	fn: (requester: Requester) => Promise<void>
): Promise<void> {
	const requester = new Requester();
	try {
		await requester.connect();
		await fn(requester);
	} finally {
		await requester.close();
	}
}

/** Lightweight REQ/REP probe to see if the Rhino ZMQ backend is reachable. */
export async function probeBackend(): Promise<BackendStatus> {
	let errorMessage: string | undefined;
	try {
		await Promise.race([
			withProbeRequester(probeRequester),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)),
					PROBE_TIMEOUT_MS
				);
			}),
		]);
		consecutiveProbeFailures = 0;
		const status: BackendStatus = { online: true };
		setCachedBackendStatus(status);
		return status;
	} catch (err) {
		errorMessage = err instanceof Error ? err.message : String(err);
		consecutiveProbeFailures++;
	}

	if (consecutiveProbeFailures < OFFLINE_AFTER_CONSECUTIVE_FAILURES) {
		const previous = getCachedBackendStatus();
		if (previous) {
			return previous;
		}
		return { online: true };
	}

	const status: BackendStatus = { online: false, error: errorMessage };
	setCachedBackendStatus(status);
	return status;
}
