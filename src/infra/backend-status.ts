import type { GetCanvasErrorsResponse } from "../types/messages.js";
import {
	type BackendStatus,
	setCachedBackendStatus,
} from "./backend-status-cache.js";
import { Requester } from "./requester.js";

const PROBE_TIMEOUT_MS = 3_000;

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
	const res = await requester.request<GetCanvasErrorsResponse>({
		type: "getCanvasErrors",
	});
	if (res.type !== "getCanvasErrors.response") {
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
	let status: BackendStatus;
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
		status = { online: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		status = { online: false, error: message };
	}
	setCachedBackendStatus(status);
	return status;
}
