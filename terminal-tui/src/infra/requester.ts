import type { SubmitJobRequest, SubmitJobResponse } from "../domain/commands.js";
import { REQ_ENDPOINT, DEBUG, REQUEST_TIMEOUT } from "../infra/connection.js";

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

	async submitJob(request: SubmitJobRequest): Promise<SubmitJobResponse> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		const payload = JSON.stringify(request);

		if (DEBUG) {
			console.log(`[REQ] Sending submitJob: ${payload.slice(0, 100)}...`);
		}

		await this.socket.send(payload);

		const messages = await this.socket.receive();

		const responseStr = messages.toString();

		if (DEBUG) {
			console.log(`[REQ] Received: ${responseStr.slice(0, 100)}...`);
		}

		try {
			return JSON.parse(responseStr) as SubmitJobResponse;
		} catch {
			throw new Error(`Invalid JSON response: ${responseStr}`);
		}
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
