import type { SubmitJobRequest } from "../types/commands.js";
import { type ConnectionConfig, resolveConnection, withConnectionToken } from "./connection.js";

let _cached: Publisher | null = null;

export class Publisher {
	private socket: import("zeromq").Push | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
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
		signal?.throwIfAborted();
		this.socket = new Push();
		await this.socket.connect(connection.pushEndpoint);
		signal?.throwIfAborted();
	}

	async publishCommand(request: SubmitJobRequest, signal?: AbortSignal): Promise<void> {
		if (!this.socket) {
			throw new Error("Publisher not connected");
		}
		if (!this.connection) {
			throw new Error("Publisher connection not resolved");
		}
		signal?.throwIfAborted();
		const payload = JSON.stringify(withConnectionToken(request, this.connection));

		await this.socket.send(payload);
		signal?.throwIfAborted();
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
	}
}

export function getPublisher(): Publisher {
	if (!_cached) _cached = new Publisher();
	return _cached;
}
