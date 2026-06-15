import type { GhMessage } from "../types/messages.js";
import { type ConnectionConfig, resolveConnection } from "./connection.js";

export type MessageHandler = (message: GhMessage) => void;

let _cached: Subscriber | null = null;

export class Subscriber {
	private socket: import("zeromq").Subscriber | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(): Promise<void> {
		const connection = resolveConnection();
		if (this.socket && this.connection?.pubEndpoint === connection.pubEndpoint) {
			return;
		}
		await this.close();
		this.connection = connection;
		const { Subscriber } = await import("zeromq");
		this.socket = new Subscriber();
		this.socket.connect(connection.pubEndpoint);
		this.socket.receiveTimeout = 1000;
		this.socket.subscribe("");
	}

	async subscribeTopic(topic: string): Promise<void> {
		if (!this.socket) {
			throw new Error("Subscriber not connected");
		}
		this.socket.subscribe(topic);
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

			try {
				const parsed = JSON.parse(payload) as GhMessage;
				handler(parsed);
			} catch {
				// ignore unparseable subscriber messages
			}
		}
	}

	async receiveOne(): Promise<GhMessage | null> {
		if (!this.socket) throw new Error("Subscriber not connected");
		const [topic, data] = await this.socket.receive();
		if (!topic || !data) return null;
		const payload = data.toString();
		return JSON.parse(payload) as GhMessage;
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
	}
}

export function getSubscriber(): Subscriber {
	if (!_cached) _cached = new Subscriber();
	return _cached;
}
