import type { GetCanvasErrorsResponse } from "../types/messages.js";
import { REQ_ENDPOINT } from "./connection.js";
import { withRequester } from "./request-helpers.js";

const PROBE_TIMEOUT_MS = 3_000;

export type BackendStatus = {
	online: boolean;
	error?: string;
};

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

/** Lightweight REQ/REP probe to see if the Rhino ZMQ backend is reachable. */
export async function probeBackend(): Promise<BackendStatus> {
	try {
		await Promise.race([
			withRequester(probeRequester),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)),
					PROBE_TIMEOUT_MS
				);
			}),
		]);
		return { online: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { online: false, error: message };
	}
}

export function formatBackendEndpoint(): string {
	return REQ_ENDPOINT.replace(/^tcp:\/\//, "");
}
