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
		await this.socket.subscribe("gh.event.");
		await this.socket.subscribe("gh.job.");
	}

	async subscribe(handler: MessageHandler): Promise<void> {
		if (!this.socket) {
			throw new Error("Subscriber not connected");
		}
		for await (const [topic, data] of this.socket) {
			const topicStr = topic.toString();
			const payload = data.toString();

			if (DEBUG) {
				console.log(`[SUB] Received ${topicStr}: ${payload.slice(0, 100)}...`);
			}

			try {
				const parsed = JSON.parse(payload) as GhMessage;
				if (parsed.type && topicStr.startsWith(parsed.type.slice(0, 8))) {
					handler(parsed);
				}
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