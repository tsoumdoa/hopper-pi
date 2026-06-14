import { submitCommand } from "../infra/command-dispatch.js";

const DEFAULT_TRANSACTION_NAME = "Hopper agent";

export async function beginRhinoAgentTransaction(
	name = DEFAULT_TRANSACTION_NAME,
): Promise<void> {
	await submitCommand("beginRhinoAgentTransaction", { name });
}

export async function commitRhinoAgentTransaction(): Promise<void> {
	await submitCommand("commitRhinoAgentTransaction", {});
}

export async function cancelRhinoAgentTransaction(): Promise<void> {
	await submitCommand("cancelRhinoAgentTransaction", {});
}
