import { ensureBackendReachable } from "./backend-status.js";
import { Requester } from "./requester.js";

export async function withRequester<T>(
	fn: (requester: Requester) => Promise<T>
): Promise<T> {
	await ensureBackendReachable();
	const requester = new Requester();
	try {
		await requester.connect();
		return await fn(requester);
	} finally {
		await requester.close();
	}
}
