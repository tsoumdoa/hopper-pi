import { classifyOperation, type JsonObject, type OperationName } from "../protocol/v2.js";
import { getRuntimeRpc, type RuntimeRpc } from "./runtime-rpc.js";

/**
 * Transitional domain-request facade. It preserves the existing tool call shape
 * while every request is carried by the process-wide RPC v2 DEALER client.
 */
export class Requester {
	constructor(private readonly runtime: RuntimeRpc = getRuntimeRpc()) { }

	async connect(): Promise<void> {
		await this.runtime.connect();
	}

	async request<T>(data: unknown): Promise<T> {
		if (!isRecord(data) || typeof data.type !== "string") {
			throw new Error("RPC domain request must contain an operation type");
		}
		const operation = data.type;
		if (!classifyOperation(operation) || isInternalOperation(operation)) {
			throw new Error(`Unsupported RPC domain operation: ${operation}`);
		}
		const { type: _type, ...args } = data;
		return this.runtime.request<T>(operation as OperationName, args as JsonObject);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInternalOperation(operation: string): boolean {
	return [
		"lifecycleHandshake",
		"getRuntimeStatus",
		"startGrasshopper",
		"getOperationResult",
		"cancelOperation",
	].includes(operation);
}
