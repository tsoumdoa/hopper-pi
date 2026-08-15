import type { JsonObject, JsonValue } from "../core/contracts.js";
import { HopperCoreError } from "../core/errors.js";
import type { WireRequest, WireResponse } from "../protocol/wire.js";
import { mapTransportError, type TransportSendState } from "../protocol/transport-errors.js";
import { type ConnectionConfig, resolveConnection, withConnectionToken } from "./connection.js";

const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export type RequestOptions = {
	receiveTimeoutMs: number;
	signal?: AbortSignal;
};

export interface RequestSocket {
	linger: number;
	connect(endpoint: string): void | Promise<void>;
	send(payload: string): Promise<unknown>;
	receive(): Promise<readonly Uint8Array[]>;
	close(): void | Promise<void>;
}

export type RequesterConstructorOptions = {
	connection?: ConnectionConfig;
	maxResponseBytes?: number;
	socketFactory?: () => RequestSocket | Promise<RequestSocket>;
};

class ReceiveTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Backend response timed out after ${timeoutMs}ms.`);
		this.name = "ReceiveTimeoutError";
	}
}

function abortError(): Error {
	const error = new Error("Backend request aborted.");
	error.name = "AbortError";
	return error;
}

export class Requester {
	private socket: RequestSocket | null = null;
	private connection: ConnectionConfig | null = null;
	private readonly configuredConnection?: ConnectionConfig;
	private readonly maxResponseBytes: number;
	private readonly socketFactory: () => RequestSocket | Promise<RequestSocket>;

	constructor(options: RequesterConstructorOptions = {}) {
		this.configuredConnection = options.connection;
		this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
			throw new RangeError("maxResponseBytes must be a positive safe integer.");
		}
		this.socketFactory = options.socketFactory ?? (async () => {
			const { Request } = await import("zeromq");
			return new Request() as unknown as RequestSocket;
		});
	}

	async connect(options: { refresh?: boolean } = {}): Promise<void> {
		if (this.socket) await this.close();
		this.connection = this.configuredConnection ?? resolveConnection(options);
		this.socket = await this.socketFactory();
		await this.socket.connect(this.connection.reqEndpoint);
	}

	async request<T>(data: unknown): Promise<T>;
	async request<T extends JsonValue>(
		request: WireRequest<string, JsonObject>,
		options: RequestOptions,
	): Promise<WireResponse<T>>;
	async request<T>(data: unknown, options?: RequestOptions): Promise<T> {
		if (!this.socket || !this.connection) {
			if (!options) throw new Error("Requester not connected");
			throw new HopperCoreError({
				code: "backend_offline",
				message: "Requester is not connected; connect before sending.",
				retryable: true,
			});
		}
		const socket = this.socket;
		let payload: string;
		try {
			payload = JSON.stringify(withConnectionToken(data, this.connection));
		} catch (error) {
			if (!options) throw error;
			throw new HopperCoreError({
				code: "invalid_input",
				message: error instanceof Error ? error.message : String(error),
				retryable: false,
			});
		}

		if (!options) {
			await socket.send(payload);
			const [response] = await socket.receive();
			return parseJsonResponse<T>(Buffer.from(response).toString("utf8"));
		}
		if (!Number.isFinite(options.receiveTimeoutMs) || options.receiveTimeoutMs <= 0) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "receiveTimeoutMs must be a positive number.",
				retryable: false,
			});
		}

		const requestType = (data as { type?: unknown }).type;
		const requestKind = requestType === "executeActions" || requestType === "restoreCheckpoint"
			? "mutation"
			: "read";
		let sendState: TransportSendState = "not_sent";
		try {
			if (options.signal?.aborted) throw abortError();
			sendState = "possibly_sent";
			await socket.send(payload);
			const frames = await receiveWithDeadline(socket, options);
			if (frames.length !== 1) {
				throw new HopperCoreError({
					code: "protocol_mismatch",
					message: `Expected one response frame, received ${frames.length}.`,
					retryable: false,
				});
			}
			const response = Buffer.from(frames[0]);
			if (response.byteLength > this.maxResponseBytes) {
				throw new HopperCoreError({
					code: "protocol_mismatch",
					message: `Backend response exceeded ${this.maxResponseBytes} bytes.`,
					retryable: false,
					details: { maxResponseBytes: this.maxResponseBytes, receivedBytes: response.byteLength },
				});
			}
			return parseWireResponse<T>(response.toString("utf8"));
		} catch (error) {
			await this.invalidateSocket(socket);
			if (error instanceof HopperCoreError) throw error;
			throw new HopperCoreError(mapTransportError(error, sendState, requestKind));
		}
	}

	async close(): Promise<void> {
		const socket = this.socket;
		this.socket = null;
		if (socket) await socket.close();
	}

	private async invalidateSocket(socket: RequestSocket): Promise<void> {
		if (this.socket === socket) this.socket = null;
		socket.linger = 0;
		await socket.close();
	}
}

async function receiveWithDeadline(
	socket: RequestSocket,
	options: RequestOptions,
): Promise<readonly Uint8Array[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abortHandler: (() => void) | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new ReceiveTimeoutError(options.receiveTimeoutMs)), options.receiveTimeoutMs);
	});
	const abort = new Promise<never>((_resolve, reject) => {
		if (!options.signal) return;
		abortHandler = () => reject(abortError());
		options.signal.addEventListener("abort", abortHandler, { once: true });
	});
	try {
		return await Promise.race([socket.receive(), timeout, abort]);
	} finally {
		if (timer) clearTimeout(timer);
		if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
	}
}

function parseJsonResponse<T>(raw: string): T {
	const parsed: unknown = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid response: expected JSON object");
	}
	return parsed as T;
}

function parseWireResponse<T>(raw: string): T {
	try {
		return parseJsonResponse<T>(raw);
	} catch (error) {
		throw new HopperCoreError({
			code: "protocol_mismatch",
			message: `Invalid backend response: ${error instanceof Error ? error.message : String(error)}`,
			retryable: false,
		});
	}
}

