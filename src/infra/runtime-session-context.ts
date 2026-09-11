import { AsyncLocalStorage } from "node:async_hooks";
import type { ConnectionConfig } from "./connection.js";
import type { RuntimeRpc } from "./runtime-rpc.js";

/** Mutable dependencies for one owned-child agent session. This is not a shared-host scheduler. */
export class RuntimeSessionContext {
	private readonly values = new Map<symbol, unknown>();

	constructor(readonly options: {
		connection?: ConnectionConfig;
		connectionProfilePath?: string;
		createRuntime?: () => RuntimeRpc;
	} = {}) {}

	run<T>(callback: () => T): T {
		return currentSession.run(this, callback);
	}

	get<T>(key: symbol, create: () => T): T {
		if (!this.values.has(key)) this.values.set(key, create());
		return this.values.get(key) as T;
	}
}

const currentSession = new AsyncLocalStorage<RuntimeSessionContext>();
// CLI and existing owned-child callers retain their single runtime until they opt in.
const ownedChildSession = new RuntimeSessionContext();

export function getRuntimeSessionContext(): RuntimeSessionContext {
	return currentSession.getStore() ?? ownedChildSession;
}
