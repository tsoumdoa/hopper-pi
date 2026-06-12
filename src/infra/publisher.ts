import type { SubmitJobRequest } from "../types/commands.js";
import {
	DEBUG,
	type ConnectionConfig,
	resolveConnection,
	withConnectionToken,
} from "./connection.js";

let _cached: Publisher | null = null;

export class Publisher {
	private socket: import("zeromq").Push | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(): Promise<void> {
		const connection = resolveConnection();
		if (
			this.socket &&
			this.connection?.pushEndpoint === connection.pushEndpoint &&
			this.connection?.token === connection.token
		) {
			return;
		}
		await this.close();
		this.connection = connection;
		const { Push } = await import("zeromq");
		this.socket = new Push();
		if (DEBUG) {
			console.log(`[PUSH] Connecting to ${connection.pushEndpoint}`);
		}
		await this.socket.connect(connection.pushEndpoint);
	}

	async publishCommand(request: SubmitJobRequest): Promise<void> {
		if (!this.socket) {
			throw new Error("Publisher not connected");
		}
		if (!this.connection) {
			throw new Error("Publisher connection not resolved");
		}
		const payload = JSON.stringify(withConnectionToken(request, this.connection));

		if (DEBUG) {
			console.log(`[PUSH] Publishing command: ${payload.slice(0, 100)}...`);
		}

		await this.socket.send(payload);
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
		if (DEBUG) {
			console.log("[PUSH] Closed");
		}
	}
}

export function getPublisher(): Publisher {
	if (!_cached) _cached = new Publisher();
	return _cached;
}
