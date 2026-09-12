import type { RuntimeStatusEventSource } from "./grasshopper-readiness.js";

export interface AdvisorySubscriberSocket {
	connect(endpoint: string): void | Promise<void>;
	subscribe(topic: string): void;
	receive(): Promise<readonly Uint8Array[]>;
	close(): void | Promise<void>;
}

export interface AdvisorySubscriberFactory {
	create(): AdvisorySubscriberSocket | Promise<AdvisorySubscriberSocket>;
}

class ZeroMqAdvisorySubscriberFactory implements AdvisorySubscriberFactory {
	async create(): Promise<AdvisorySubscriberSocket> {
		const { Subscriber } = await import("zeromq");
		const socket = new Subscriber();
		return {
			connect: (endpoint) => socket.connect(endpoint),
			subscribe: (topic) => socket.subscribe(topic),
			receive: () => socket.receive(),
			close: () => socket.close(),
		};
	}
}

export class SubscriberStatusEventSource implements RuntimeStatusEventSource {
	constructor(
		private readonly endpoint: string,
		private readonly factory: AdvisorySubscriberFactory = new ZeroMqAdvisorySubscriberFactory(),
		private readonly retryDelayMs = 250,
		private readonly sleep: (delayMs: number) => Promise<void> =
			(delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
	) { }

	async subscribe(onWakeup: () => void): Promise<() => Promise<void>> {
		let stopped = false;
		let socket = await this.connect();

		const loop = async () => {
			while (!stopped) {
				try {
					const frames = await socket.receive();
					if (frames.length > 0) onWakeup();
				} catch {
					if (stopped) return;
					try { await socket.close(); } catch { }
					await this.sleep(this.retryDelayMs);
					if (stopped) return;
					try {
						const replacement = await this.connect();
						if (stopped) {
							try { await replacement.close(); } catch { }
							return;
						}
						socket = replacement;
						onWakeup();
					} catch {
						// Retry until the readiness deadline or unsubscribe closes the source.
					}
				}
			}
		};
		void loop();

		return async () => {
			if (stopped) return;
			stopped = true;
			try { await socket.close(); } catch { }
		};
	}

	private async connect(): Promise<AdvisorySubscriberSocket> {
		const socket = await this.factory.create();
		try {
			await socket.connect(this.endpoint);
			socket.subscribe("");
			return socket;
		} catch (error) {
			try { await socket.close(); } catch { }
			throw error;
		}
	}
}
