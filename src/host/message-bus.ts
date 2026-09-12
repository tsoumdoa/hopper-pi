import type { ServerMessage } from "./protocol.js";

export type MessageListener = (message: ServerMessage) => void;

export class HostMessageBus {
	private readonly listeners = new Set<MessageListener>();

	subscribe(listener: MessageListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	publish(message: ServerMessage): void {
		for (const listener of this.listeners) listener(message);
	}
}
