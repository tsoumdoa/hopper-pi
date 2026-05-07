import { REQ_ENDPOINT, DEBUG } from "./connection.js";

export class Requester {
	private socket: import("zeromq").Request | null = null;

	async connect(): Promise<void> {
		const { Request } = await import("zeromq");
		this.socket = new Request();
		if (DEBUG) {
			console.log(`[REQ] Connecting to ${REQ_ENDPOINT}`);
		}
		await this.socket.connect(REQ_ENDPOINT);
	}

	async request<T>(data: unknown): Promise<T> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		const payload = JSON.stringify(data);

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
