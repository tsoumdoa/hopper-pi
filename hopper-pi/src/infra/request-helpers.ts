import {
	BackendOfflineError,
	isBackendKnownOffline,
} from "./backend-status-cache.js";
import { Requester } from "./requester.js";

export async function withRequester<T>(
	fn: (requester: Requester) => Promise<T>
): Promise<T> {
	if (isBackendKnownOffline()) {
		throw new BackendOfflineError();
	}
	const requester = new Requester();
	try {
		await requester.connect();
		return await fn(requester);
	} finally {
		await requester.close();
	}
}
