import { submitCommand } from "../infra/command-dispatch.js";
import type { CommandAction } from "../types/commands.js";

const DEFAULT_TRANSACTION_NAME = "Hopper agent";

type TransactionScope = {
	begin: (name?: string) => Promise<void>;
	commit: () => Promise<void>;
	cancel: () => Promise<void>;
};

export function createTransactionScope(
	beginAction: CommandAction,
	commitAction: CommandAction,
	cancelAction: CommandAction,
): TransactionScope {
	return {
		begin: async (name = DEFAULT_TRANSACTION_NAME) => { await submitCommand(beginAction, { name }); },
		commit: async () => { await submitCommand(commitAction, {}); },
		cancel: async () => { await submitCommand(cancelAction, {}); },
	};
}

const agentScope = createTransactionScope(
	"beginAgentTransaction",
	"commitAgentTransaction",
	"cancelAgentTransaction",
);

const rhinoScope = createTransactionScope(
	"beginRhinoAgentTransaction",
	"commitRhinoAgentTransaction",
	"cancelRhinoAgentTransaction",
);

export const beginAgentTransaction = agentScope.begin;
export const commitAgentTransaction = agentScope.commit;
export const cancelAgentTransaction = agentScope.cancel;

export const beginRhinoAgentTransaction = rhinoScope.begin;
export const commitRhinoAgentTransaction = rhinoScope.commit;
export const cancelRhinoAgentTransaction = rhinoScope.cancel;

async function runSafe(fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch {
		// Backend may be disconnected.
	}
}

export async function beginTransactionPair(): Promise<void> {
	await runSafe(beginAgentTransaction);
	await runSafe(beginRhinoAgentTransaction);
}

export async function commitTransactionPair(): Promise<void> {
	await runSafe(commitAgentTransaction);
	await runSafe(commitRhinoAgentTransaction);
}

export async function cancelTransactionPair(): Promise<void> {
	await runSafe(cancelAgentTransaction);
	await runSafe(cancelRhinoAgentTransaction);
}
