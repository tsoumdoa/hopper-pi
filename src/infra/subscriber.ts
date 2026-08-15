import type { GhMessage } from "../types/messages.js";
import { type ConnectionConfig, resolveConnection } from "./connection.js";

export type MessageHandler = (message: GhMessage) => void;

let _cached: Subscriber | null = null;

export class Subscriber {
	private socket: import("zeromq").Subscriber | null = null;
	private connection: ConnectionConfig | null = null;
	private receiving = false;

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

	async subscribe(handler: MessageHandler, signal?: AbortSignal): Promise<void> {
		if (!this.socket) {
			throw new Error("Subscriber not connected");
		}
		if (this.receiving) throw new Error("Subscriber already has an active receive loop");
		this.receiving = true;
		try {
			while (!signal?.aborted && this.socket) {
				let frames: Buffer[];
				try {
					frames = await this.socket.receive();
				} catch (error) {
					if (signal?.aborted || !this.socket) break;
					if ((error as { code?: string }).code === "EAGAIN") continue;
					throw error;
				}
				const [topic, data] = frames;
				if (!topic || !data) continue;

				const topicStr = topic.toString();
				const payload = data.toString();

				let parsed: GhMessage;
				try {
					parsed = JSON.parse(payload) as GhMessage;
				} catch {
					continue;
				}
				if (parsed.type !== topicStr) continue;
				handler(parsed);
			}
		} finally {
			this.receiving = false;
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
