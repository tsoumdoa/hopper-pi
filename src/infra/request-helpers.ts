import { ensureBackendReachable } from "./backend-status.js";
import { Requester } from "./requester.js";

export async function withRequester<T>(
	fn: (requester: Requester) => Promise<T>,
	options: { signal?: AbortSignal } = {},
): Promise<T> {
	options.signal?.throwIfAborted();
	await ensureBackendReachable();
	options.signal?.throwIfAborted();
	const requester = new Requester(options.signal);
	try {
		await requester.connect({ signal: options.signal });
		return await fn(requester);
	} finally {
		await requester.close();
	}
}
