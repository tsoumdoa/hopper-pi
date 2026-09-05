import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HostShutdownCoordinator,
	NORMAL_SHUTDOWN_FORCE_EXIT_MS,
	PARENT_GONE_FORCE_EXIT_MS,
	PARENT_POLL_INTERVAL_MS,
	type HostTimerApi,
	type UnrefTimer,
	watchParentProcess,
} from "./lifecycle.js";

describe("parent process watcher", () => {
	afterEach(() => vi.useRealTimers());

	it("stops the host when the parent disappears", () => {
		vi.useFakeTimers();
		const onGone = vi.fn();
		const isAlive = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
		watchParentProcess(42, onGone, { intervalMs: 10, isAlive });
		vi.advanceTimersByTime(20);
		expect(onGone).toHaveBeenCalledOnce();
	});

	it("does nothing when no parent PID was supplied", () => {
		const onGone = vi.fn();
		watchParentProcess(undefined, onGone)();
		expect(onGone).not.toHaveBeenCalled();
	});

	it("keeps the default poll at two seconds and unrefs the interval", () => {
		const timers = new FakeTimerApi();
		const onGone = vi.fn();
		const isAlive = vi.fn().mockReturnValue(false);

		watchParentProcess(42, onGone, { isAlive, timers });
		timers.advanceBy(PARENT_POLL_INTERVAL_MS - 1);
		expect(onGone).not.toHaveBeenCalled();
		timers.advanceBy(1);

		expect(onGone).toHaveBeenCalledOnce();
		expect(PARENT_POLL_INTERVAL_MS + PARENT_GONE_FORCE_EXIT_MS).toBeLessThan(3_000);
		expect(timers.created).toHaveLength(1);
		expect(timers.created[0]?.unrefCalled).toBe(true);
	});
});

describe("host shutdown coordinator", () => {
	it("exits immediately when parent-loss cleanup completes", async () => {
		const fixture = shutdownFixture();

		const shutdown = fixture.coordinator.request("parent_gone");
		expect(fixture.cleanup).toHaveBeenCalledOnce();
		expect(fixture.timers.timeoutDelays()).toEqual([PARENT_GONE_FORCE_EXIT_MS]);
		expect(PARENT_GONE_FORCE_EXIT_MS).toBeLessThan(1_000);

		fixture.cleanupDone.resolve();
		await shutdown;

		expect(fixture.exit).toHaveBeenCalledWith(0);
		expect(fixture.timers.now).toBe(0);
		expect(fixture.timers.created.every((timer) => timer.unrefCalled)).toBe(true);
	});

	it("force-exits a hung parent-loss cleanup before one second", () => {
		const fixture = shutdownFixture();

		void fixture.coordinator.request("parent_gone");
		fixture.timers.advanceBy(PARENT_GONE_FORCE_EXIT_MS - 1);
		expect(fixture.exit).not.toHaveBeenCalled();
		fixture.timers.advanceBy(1);

		expect(fixture.exit).toHaveBeenCalledWith(0);
		expect(fixture.exit).toHaveBeenCalledOnce();
	});

	it("keeps the longer deadline for normal shutdown", async () => {
		const fixture = shutdownFixture();

		const first = fixture.coordinator.request("normal");
		const repeated = fixture.coordinator.request("normal");
		expect(repeated).toBe(first);
		expect(fixture.cleanup).toHaveBeenCalledOnce();
		expect(fixture.timers.timeoutDelays()).toEqual([NORMAL_SHUTDOWN_FORCE_EXIT_MS]);
		expect(fixture.timers.created.every((timer) => timer.unrefCalled)).toBe(true);
		fixture.timers.advanceBy(NORMAL_SHUTDOWN_FORCE_EXIT_MS - 1);
		expect(fixture.exit).not.toHaveBeenCalled();

		fixture.cleanupDone.resolve();
		await first;
		expect(fixture.exit).not.toHaveBeenCalled();
		expect(fixture.timers.activeCount()).toBe(0);

		await fixture.coordinator.request("normal");
		expect(fixture.cleanup).toHaveBeenCalledOnce();
		expect(fixture.timers.activeCount()).toBe(0);
	});

	it("shortens an already-running normal shutdown when the parent disappears", () => {
		const fixture = shutdownFixture();

		void fixture.coordinator.request("normal");
		fixture.timers.advanceBy(100);
		void fixture.coordinator.request("parent_gone");
		void fixture.coordinator.request("parent_gone");

		expect(fixture.cleanup).toHaveBeenCalledOnce();
		expect(fixture.timers.timeoutDelays()).toEqual([
			NORMAL_SHUTDOWN_FORCE_EXIT_MS,
			PARENT_GONE_FORCE_EXIT_MS,
		]);
		fixture.timers.advanceBy(PARENT_GONE_FORCE_EXIT_MS - 1);
		expect(fixture.exit).not.toHaveBeenCalled();
		fixture.timers.advanceBy(1);
		expect(fixture.exit).toHaveBeenCalledOnce();
	});

	it("reports a parent-loss cleanup failure and exits with code one", async () => {
		const fixture = shutdownFixture();
		const shutdown = fixture.coordinator.request("parent_gone");

		fixture.cleanupDone.reject(new Error("close failed"));
		await shutdown;

		expect(fixture.reportError).toHaveBeenCalledOnce();
		expect(fixture.setExitCode).toHaveBeenCalledWith(1);
		expect(fixture.exit).toHaveBeenCalledWith(1);
	});
});

function shutdownFixture() {
	const timers = new FakeTimerApi();
	const cleanupDone = deferred();
	let exitCode = 0;
	const cleanup = vi.fn(() => cleanupDone.promise);
	const exit = vi.fn();
	const setExitCode = vi.fn((code: number) => { exitCode = code; });
	const reportError = vi.fn();
	const coordinator = new HostShutdownCoordinator({
		cleanup,
		exit,
		getExitCode: () => exitCode,
		setExitCode,
		reportError,
		timers,
	});
	return {
		coordinator,
		timers,
		cleanupDone,
		cleanup,
		exit,
		setExitCode,
		reportError,
	};
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

class FakeTimer implements UnrefTimer {
	active = true;
	unrefCalled = false;

	constructor(
		readonly callback: () => void,
		public dueAt: number,
		readonly delayMs: number,
		readonly intervalMs?: number,
	) {}

	unref(): void {
		this.unrefCalled = true;
	}
}

class FakeTimerApi implements HostTimerApi {
	readonly created: FakeTimer[] = [];
	now = 0;

	setTimeout(callback: () => void, delayMs: number): FakeTimer {
		return this.add(callback, delayMs);
	}

	clearTimeout(timer: UnrefTimer): void {
		(timer as FakeTimer).active = false;
	}

	setInterval(callback: () => void, intervalMs: number): FakeTimer {
		return this.add(callback, intervalMs, intervalMs);
	}

	clearInterval(timer: UnrefTimer): void {
		(timer as FakeTimer).active = false;
	}

	advanceBy(durationMs: number): void {
		const target = this.now + durationMs;
		while (true) {
			const next = this.created
				.filter((timer) => timer.active && timer.dueAt <= target)
				.sort((left, right) => left.dueAt - right.dueAt)[0];
			if (!next) break;
			this.now = next.dueAt;
			if (next.intervalMs === undefined) next.active = false;
			next.callback();
			if (next.active && next.intervalMs !== undefined) next.dueAt += next.intervalMs;
		}
		this.now = target;
	}

	timeoutDelays(): number[] {
		return this.created
			.filter((timer) => timer.intervalMs === undefined)
			.map((timer) => timer.delayMs);
	}

	activeCount(): number {
		return this.created.filter((timer) => timer.active).length;
	}

	private add(callback: () => void, delayMs: number, intervalMs?: number): FakeTimer {
		const timer = new FakeTimer(callback, this.now + delayMs, delayMs, intervalMs);
		this.created.push(timer);
		return timer;
	}
}
