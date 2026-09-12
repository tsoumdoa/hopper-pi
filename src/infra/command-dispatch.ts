import { ensureBackendReachable } from "./backend-status.js";
import type { CommandAction } from "../types/commands.js";
import { classifyOperation, type JsonObject } from "../protocol/v2.js";
import { getRuntimeRpc } from "./runtime-rpc.js";

export async function submitCommand(
	action: CommandAction,
	params: unknown,
): Promise<{ jobId: string }> {
	if (classifyOperation(action) !== "mutation") {
		throw new Error(`Command dispatch requires a mutation operation: ${action}`);
	}
	await ensureBackendReachable();
	const response = await getRuntimeRpc().invoke(
		action,
		params as JsonObject,
	);
	return { jobId: response.operationId! };
}

export type SubmitResult = { jobId: string };
