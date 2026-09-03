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

it("closes a socket whose initial connect fails", async () => {
	const socket = new FakeSocket();
	socket.connectError = new Error("connect failed");
	const source = new SubscriberStatusEventSource(
		"tcp://127.0.0.1:32002",
		new FakeFactory([socket]),
	);

	await expect(source.subscribe(() => { })).rejects.toThrow("connect failed");
	expect(socket.closeCount).toBe(1);
});

it("closes a replacement socket when unsubscribe races reconnect", async () => {
	const first = new FakeSocket();
	const second = new FakeSocket();
	second.connectGate = deferred<void>();
	const factory = new FakeFactory([first, second]);
	const source = new SubscriberStatusEventSource(
		"tcp://127.0.0.1:32002",
		factory,
		0,
		async () => { },
	);
	const unsubscribe = await source.subscribe(() => { });
	first.fail(new Error("connection lost"));
	await vi.waitFor(() => expect(factory.createCount).toBe(2));

	const closing = unsubscribe();
	second.connectGate.resolve();
	await closing;
	await vi.waitFor(() => expect(second.closeCount).toBe(1));
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
	connectError: Error | null = null;
	connectGate: ReturnType<typeof deferred<void>> | null = null;
	closeCount = 0;
	private pending = deferred<readonly Uint8Array[]>();
	private receiving = false;

	async connect(endpoint: string): Promise<void> {
		this.endpoint = endpoint;
		if (this.connectError) throw this.connectError;
		await this.connectGate?.promise;
	}

	subscribe(topic: string): void {
		this.topic = topic;
	}

	receive(): Promise<readonly Uint8Array[]> {
		this.receiving = true;
		return this.pending.promise;
	}

	close(): void {
		this.closeCount++;
		if (this.receiving) this.pending.reject(new Error("closed"));
	}

	fail(error: Error): void {
		this.pending.reject(error);
	}
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value?: T) => void;
	reject: (error: Error) => void;
} {
	let resolve!: (value?: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise as (value?: T) => void;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
