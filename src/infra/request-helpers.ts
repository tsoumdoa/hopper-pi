import { ensureBackendReachable } from "./backend-status.js";
import { Requester } from "./requester.js";

export async function withRequester<T>(
	fn: (requester: Requester) => Promise<T>,
	options: { signal?: AbortSignal; skipProbe?: boolean } = {},
): Promise<T> {
	if (!options.skipProbe) await ensureBackendReachable();
	const requester = new Requester();
	try {
		await requester.connect();
		return await fn(requester);
	} finally {
		await requester.close();
	}
}
