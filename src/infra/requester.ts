import {
	DEBUG,
	type ConnectionConfig,
	resolveConnection,
	withConnectionToken,
} from "./connection.js";

export class Requester {
	private socket: import("zeromq").Request | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(options: { refresh?: boolean } = {}): Promise<void> {
		const { Request } = await import("zeromq");
		this.connection = resolveConnection(options);
		this.socket = new Request();
		if (DEBUG) {
			console.log(`[REQ] Connecting to ${this.connection.reqEndpoint}`);
		}
		await this.socket.connect(this.connection.reqEndpoint);
	}

	async request<T>(data: unknown): Promise<T> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		if (!this.connection) {
			throw new Error("Requester connection not resolved");
		}
		const payload = JSON.stringify(withConnectionToken(data, this.connection));

		if (DEBUG) {
			console.log(`[REQ] Sending: ${payload.slice(0, 100)}...`);
		}

		await this.socket.send(payload);

		const [response] = await this.socket.receive();

		if (DEBUG) {
			console.log(`[REQ] Received: ${response.toString().slice(0, 100)}...`);
		}

		return JSON.parse(response.toString()) as T;
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
		if (DEBUG) {
			console.log("[REQ] Closed");
		}
	}
}
