import { expect, it, vi } from "vitest";
import {
	SubscriberStatusEventSource,
	type AdvisorySubscriberFactory,
	type AdvisorySubscriberSocket,
} from "./status-event-source.js";

it("reconnects the advisory subscriber and emits a status wakeup", async () => {
	const first = new FakeSocket();
	const second = new FakeSocket();
	const factory = new FakeFactory([first, second]);
	let wakeups = 0;
	const source = new SubscriberStatusEventSource(
		"tcp://127.0.0.1:32002",
		factory,
		0,
		async () => { },
	);
	const unsubscribe = await source.subscribe(() => { wakeups++; });

	first.fail(new Error("connection lost"));
	await vi.waitFor(() => expect(factory.createCount).toBe(2));

	expect(second.endpoint).toBe("tcp://127.0.0.1:32002");
	expect(second.topic).toBe("");
	expect(wakeups).toBe(1);
	await unsubscribe();
});

class FakeFactory implements AdvisorySubscriberFactory {
	createCount = 0;

	constructor(private readonly sockets: FakeSocket[]) { }

	create(): AdvisorySubscriberSocket {
		const socket = this.sockets[this.createCount++];
		if (!socket) throw new Error("No fake socket available");
		return socket;
	}
}

class FakeSocket implements AdvisorySubscriberSocket {
	endpoint: string | null = null;
	topic: string | null = null;
	private pending = deferred<readonly Uint8Array[]>();

	connect(endpoint: string): void {
		this.endpoint = endpoint;
	}

	subscribe(topic: string): void {
		this.topic = topic;
	}

	receive(): Promise<readonly Uint8Array[]> {
		return this.pending.promise;
	}

	close(): void {
		this.pending.reject(new Error("closed"));
	}

	fail(error: Error): void {
		this.pending.reject(error);
	}
}

function deferred<T>(): {
	promise: Promise<T>;
	reject: (error: Error) => void;
} {
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((_resolve, rejectPromise) => { reject = rejectPromise; });
	return { promise, reject };
}
