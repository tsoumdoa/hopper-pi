import type { SubmitJobRequest } from "../types/commands.js";
import { PUSH_ENDPOINT, DEBUG } from "./connection.js";

export class Publisher {
	private socket: import("zeromq").Push | null = null;

	async connect(): Promise<void> {
		const { Push } = await import("zeromq");
		this.socket = new Push();
		if (DEBUG) {
			console.log(`[PUSH] Connecting to ${PUSH_ENDPOINT}`);
		}
		await this.socket.connect(PUSH_ENDPOINT);
	}

	async publishCommand(request: SubmitJobRequest): Promise<void> {
		if (!this.socket) {
			throw new Error("Publisher not connected");
		}
		const payload = JSON.stringify(request);

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
