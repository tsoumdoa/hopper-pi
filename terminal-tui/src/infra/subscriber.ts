import type { GhMessage } from "../domain/messages.js";
import { PUB_ENDPOINT, DEBUG } from "./connection.js";

export type MessageHandler = (message: GhMessage) => void;

export class Subscriber {
	private socket: import("zeromq").Subscriber | null = null;

	async connect(): Promise<void> {
		const { Subscriber } = await import("zeromq");
		this.socket = new Subscriber();
		if (DEBUG) {
			console.log(`[SUB] Connecting to ${PUB_ENDPOINT}`);
		}
		await this.socket.connect(PUB_ENDPOINT);
		await this.socket.subscribe("");
	}

	async subscribeTopic(topic: string): Promise<void> {
		if (!this.socket) {
			throw new Error("Subscriber not connected");
		}
		if (DEBUG) {
			console.log(`[SUB] Subscribing to: ${topic}`);
		}
		await this.socket.subscribe(topic);
	}

	async subscribe(handler: MessageHandler): Promise<void> {
		if (!this.socket) {
			throw new Error("Subscriber not connected");
		}
		while (true) {
			const [topic, data] = await this.socket.receive();
			if (!topic || !data) continue;

			const topicStr = topic.toString();
			const payload = data.toString();

			if (DEBUG) {
				console.log(`[SUB] Received ${topicStr}: ${payload.slice(0, 100)}...`);
			}

			try {
				const parsed = JSON.parse(payload) as GhMessage;
				handler(parsed);
			} catch (err) {
				console.error(`[SUB] Failed to parse message: ${err}`);
			}
		}
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
		if (DEBUG) {
			console.log("[SUB] Closed");
		}
	}
}