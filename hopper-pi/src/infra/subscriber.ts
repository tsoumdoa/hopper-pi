import type { GhMessage } from "../types/messages.js";
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

	async receiveOne(timeoutMs?: number): Promise<GhMessage | null> {
		if (!this.socket) throw new Error("Subscriber not connected");
		const [topic, data] = await this.socket.receive({ timeout: timeoutMs ?? 0 });
		if (!topic || !data) return null;
		const payload = data.toString();
		if (DEBUG) {
			console.log(`[SUB] Received one: ${payload.slice(0, 100)}...`);
		}
		return JSON.parse(payload) as GhMessage;
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
	}
}
