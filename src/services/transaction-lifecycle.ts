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

export async function beginTransactionPairStrict(): Promise<void> {
	await beginAgentTransaction();
	await beginRhinoAgentTransaction();
}

export async function commitTransactionPairStrict(): Promise<void> {
	await commitAgentTransaction();
	await commitRhinoAgentTransaction();
}

export async function cancelTransactionPairStrict(): Promise<void> {
	const results = await Promise.allSettled([
		cancelAgentTransaction(),
		cancelRhinoAgentTransaction(),
	]);
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length > 0) {
		throw new AggregateError(
			failures.map((result) => (result as PromiseRejectedResult).reason),
			"Failed to cancel Hopper transaction pair",
		);
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
