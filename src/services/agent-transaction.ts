import { submitCommand } from "../tools/edit-handlers.js";

const DEFAULT_TRANSACTION_NAME = "Hopper agent";

export async function beginAgentTransaction(name = DEFAULT_TRANSACTION_NAME): Promise<void> {
	await submitCommand("beginAgentTransaction", { name });
}

export async function commitAgentTransaction(): Promise<void> {
	await submitCommand("commitAgentTransaction", {});
}

export async function cancelAgentTransaction(): Promise<void> {
	await submitCommand("cancelAgentTransaction", {});
}
