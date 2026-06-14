import {
	beginAgentTransaction,
	cancelAgentTransaction,
	commitAgentTransaction,
} from "./agent-transaction.js";
import {
	beginRhinoAgentTransaction,
	cancelRhinoAgentTransaction,
	commitRhinoAgentTransaction,
} from "./rhino-agent-transaction.js";

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
