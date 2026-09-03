import { describe, expect, it, vi } from "vitest";
import type { RuntimeStatus } from "../protocol/v2.js";
import {
	GrasshopperReadinessCoordinator,
	GrasshopperReadinessError,
	type ReadinessClock,
	type RuntimeStatusEventSource,
} from "./grasshopper-readiness.js";

const LIFECYCLE_ID = "life-readiness-1";

describe("GrasshopperReadinessCoordinator", () => {
	it("subscribes first and consumes a wakeup published during the first status read", async () => {
		const events = new FakeEvents();
		let reads = 0;
		let starts = 0;
		const coordinator = createCoordinator({
			events,
			readStatus: async () => {
				reads++;
				if (reads === 1) {
					events.emitEvent();
					return status("not_loaded", false, 1);
				}
				return reads === 2
					? status("loading", false, 2)
					: status("ready", true, 3);
			},
			startGrasshopper: async () => { starts++; },
		});

		const result = await coordinator.ensureReady();

		expect(result.revision).toBe(3);
		expect(events.subscribeCount).toBe(1);
		expect(events.unsubscribeCount).toBe(1);
		expect(starts).toBe(1);
		expect(reads).toBe(3);
	});

	it("rereads at the deadline so a dropped event cannot hide readiness", async () => {
		const clock = new FakeClock();
		let reads = 0;
		const coordinator = createCoordinator({
			clock,
			readStatus: async () => {
				reads++;
				return reads < 3
					? status("loading", false, reads)
					: status("ready", true, reads);
			},
		});

		const pending = coordinator.ensureReady();
		await vi.waitFor(() => expect(clock.timerCount).toBe(1));
		clock.advance(60_000);

		await expect(pending).resolves.toMatchObject({ revision: 3 });
		expect(reads).toBe(3);
	});

	it("uses a reconnect notification only as a wakeup and rereads full status", async () => {
		const events = new FakeEvents();
		let reads = 0;
		const coordinator = createCoordinator({
			events,
			readStatus: async () => {
				reads++;
				if (reads === 3) throw new Error("RPC socket was reconnecting");
				return reads < 4
					? status("loading", false, reads)
					: status("ready", true, reads);
			},
		});

		const pending = coordinator.ensureReady();
		await vi.waitFor(() => expect(reads).toBe(2));
		events.emitEvent();
		await vi.waitFor(() => expect(reads).toBe(3));
		events.emitReconnect();

		await expect(pending).resolves.toMatchObject({ revision: 4 });
		expect(reads).toBe(4);
	});

	it("coalesces simultaneous requests and starts Grasshopper once", async () => {
		const events = new FakeEvents();
		const firstRead = deferred<RuntimeStatus>();
		let reads = 0;
		let starts = 0;
		const coordinator = createCoordinator({
			events,
			readStatus: async () => {
				reads++;
				return reads === 1 ? firstRead.promise : status("ready", true, 2);
			},
			startGrasshopper: async () => { starts++; },
		});

		const first = coordinator.ensureReady();
		const second = coordinator.ensureReady();
		expect(first).toBe(second);
		firstRead.resolve(status("not_loaded", false, 1));

		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult).toBe(secondResult);
		expect(starts).toBe(1);
		expect(events.subscribeCount).toBe(1);
	});

	it("publishes the user warning before the single lazy start request", async () => {
		const order: string[] = [];
		let reads = 0;
		const coordinator = createCoordinator({
			readStatus: async () => reads++ === 0
				? status("not_loaded", false, 1)
				: status("ready", true, 2),
			beforeStartGrasshopper: async (observed) => {
				order.push(`notice:${observed.revision}`);
			},
			startGrasshopper: async () => { order.push("start"); },
		});

		await Promise.all([coordinator.ensureReady(), coordinator.ensureReady()]);

		expect(order).toEqual(["notice:1", "start"]);
	});

	it("does not submit when ready Grasshopper has no active document", async () => {
		const observed = status("ready", false, 9);
		const coordinator = createCoordinator({ readStatus: async () => observed });

		await expect(coordinator.ensureReady()).rejects.toMatchObject({
			name: "GrasshopperReadinessError",
			reasonCode: "NO_ACTIVE_GRASSHOPPER_DOCUMENT",
			status: observed,
		} satisfies Partial<GrasshopperReadinessError>);
	});

	it("times out after a final full status read", async () => {
		const clock = new FakeClock();
		let reads = 0;
		const coordinator = createCoordinator({
			clock,
			readStatus: async () => status("loading", false, ++reads),
		});
		const pending = coordinator.ensureReady();
		await vi.waitFor(() => expect(clock.timerCount).toBe(1));

		clock.advance(60_000);

		await expect(pending).rejects.toMatchObject({
			name: "GrasshopperReadinessError",
			reasonCode: "GRASSHOPPER_START_FAILED",
		});
		expect(reads).toBe(3);
	});
});

function status(
	grasshopperState: RuntimeStatus["grasshopper"]["state"],
	activeDocument: boolean,
	revision: number,
): RuntimeStatus {
	const value: RuntimeStatus = {
		protocolVersion: 2,
		revision,
		observedAt: revision,
		lifecycle: { state: "running", changedAt: 1, reason: null },
		transport: { ready: true, lifecycleInstanceId: LIFECYCLE_ID },
		host: {
			state: "running",
			processId: 42,
			nodePath: "/usr/local/bin/node",
			nodeVersion: "22.19.0",
			handshake: "live",
			healthFailureCount: 0,
		},
		rhino: { activeDocument: true, documentName: "model.3dm" },
		grasshopper: {
			state: grasshopperState,
			activeDocument,
			documentName: activeDocument ? "definition.gh" : null,
		},
		dispatcher: { acceptingExternalWork: true, depth: 0, capacity: 64 },
		errors: { transport: null, host: null, rhino: null, grasshopper: null, dispatcher: null },
	};
	return value;
}

function createCoordinator(overrides: {
	events?: FakeEvents;
	clock?: FakeClock;
	readStatus?: () => Promise<RuntimeStatus>;
	startGrasshopper?: () => Promise<void>;
	beforeStartGrasshopper?: (status: RuntimeStatus) => void | Promise<void>;
}): GrasshopperReadinessCoordinator {
	return new GrasshopperReadinessCoordinator({
		lifecycleInstanceId: LIFECYCLE_ID,
		events: overrides.events ?? new FakeEvents(),
		clock: overrides.clock,
		readStatus: overrides.readStatus ?? (async () => status("ready", true, 1)),
		startGrasshopper: overrides.startGrasshopper ?? (async () => { }),
		beforeStartGrasshopper: overrides.beforeStartGrasshopper,
	});
}

class FakeEvents implements RuntimeStatusEventSource {
	private listener: (() => void) | null = null;
	subscribeCount = 0;
	unsubscribeCount = 0;

	async subscribe(onWakeup: () => void): Promise<() => void> {
		this.subscribeCount++;
		this.listener = onWakeup;
		return () => {
			this.unsubscribeCount++;
			this.listener = null;
		};
	}

	emitEvent(): void {
		this.listener?.();
	}

	emitReconnect(): void {
		this.listener?.();
	}
}

class FakeClock implements ReadinessClock {
	private current = 0;
	private nextId = 0;
	private readonly timers = new Map<number, { at: number; callback: () => void }>();

	get timerCount(): number {
		return this.timers.size;
	}

	now(): number {
		return this.current;
	}

	setTimeout(callback: () => void, delayMs: number): unknown {
		const id = ++this.nextId;
		this.timers.set(id, { at: this.current + delayMs, callback });
		return id;
	}

	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}

	advance(delayMs: number): void {
		this.current += delayMs;
		const due = [...this.timers.entries()]
			.filter(([, timer]) => timer.at <= this.current)
			.sort((left, right) => left[1].at - right[1].at);
		for (const [id, timer] of due) {
			this.timers.delete(id);
			timer.callback();
		}
	}
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => { resolve = accept; });
	return { promise, resolve };
}
