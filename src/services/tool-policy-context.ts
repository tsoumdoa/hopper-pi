import { AsyncLocalStorage } from "node:async_hooks";

export class ToolPolicyDenied extends Error {
	constructor(readonly code: string) {
		super(`Tool unavailable: ${code}. Review Agent tools settings.`);
		this.name = "ToolPolicyDenied";
	}
}

type DispatchContext = { admit: () => Promise<void>; assertValid: () => void };
// Pi can load the main extension and choices in separate module loaders.
const key = Symbol.for("hopper.tool-policy.dispatch-context");
const shared = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<DispatchContext> };
const dispatchContext = shared[key] ??= new AsyncLocalStorage<DispatchContext>();

export function withToolDispatchContext<T>(admit: () => Promise<void>, run: () => T, assertValid: () => void = () => {}): T {
	return dispatchContext.run({ admit, assertValid }, run);
}

export function assertCurrentToolDispatchValid(): void { dispatchContext.getStore()?.assertValid(); }

/** Called after asynchronous prerequisites and immediately before transport send.
 * Non-agent lifecycle/connection operations have no tool dispatch context. */
export async function admitCurrentToolDispatch(): Promise<void> {
	await dispatchContext.getStore()?.admit();
}
