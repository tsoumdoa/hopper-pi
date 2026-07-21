import { Subscriber } from "./subscriber.js";
import type { GhJobStatus } from "../types/messages.js";

/**
 * Background listener for `gh.job.status` events published by the plugin.
 *
 * Jobs are submitted fire-and-forget over PUSH/PULL; the plugin publishes
 * per-job status (including the operation's result string, which carries
 * instance/port GUIDs for add operations) over PUB/SUB. This listener collects
 * terminal statuses so tools can report real results instead of opaque jobIds.
 */

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const MAX_TRACKED_JOBS = 1000;
/** Small delay after a fresh SUB connect so the subscription propagates before jobs run. */
const SUBSCRIPTION_SETTLE_MS = 75;

class JobStatusListener {
	private subscriber: Subscriber | null = null;
	private running = false;
	private startPromise: Promise<void> | null = null;
	private terminal = new Map<string, GhJobStatus>();
	private order: string[] = [];
	private waiters = new Map<string, Array<(status: GhJobStatus) => void>>();

	/** Start listening. Safe to call repeatedly; never throws. */
	async ensureStarted(): Promise<boolean> {
		if (this.running) return true;
		if (!this.startPromise) {
			this.startPromise = this.start();
		}
		try {
			await this.startPromise;
			return this.running;
		} catch {
			this.startPromise = null;
			return false;
		}
	}

	private async start(): Promise<void> {
		const subscriber = new Subscriber();
		await subscriber.connect();
		this.subscriber = subscriber;
		this.running = true;
		void this.receiveLoop();
		await new Promise((resolve) => setTimeout(resolve, SUBSCRIPTION_SETTLE_MS));
	}

	private async receiveLoop(): Promise<void> {
		while (this.running && this.subscriber) {
			try {
				const message = await this.subscriber.receiveOne();
				if (message?.type === "gh.job.status") {
					this.record(message);
				}
			} catch {
				// receive timeout or transient socket error — keep listening
			}
		}
	}

	private record(status: GhJobStatus): void {
		if (!TERMINAL_STATES.has(status.state)) return;

		if (!this.terminal.has(status.jobId)) {
			this.order.push(status.jobId);
			while (this.order.length > MAX_TRACKED_JOBS) {
				const evicted = this.order.shift();
				if (evicted) this.terminal.delete(evicted);
			}
		}
		this.terminal.set(status.jobId, status);

		const pending = this.waiters.get(status.jobId);
		if (pending) {
			this.waiters.delete(status.jobId);
			for (const resolve of pending) resolve(status);
		}
	}

	/** Wait for a single job to reach a terminal state, or resolve null on timeout. */
	waitForJob(jobId: string, timeoutMs: number): Promise<GhJobStatus | null> {
		const existing = this.terminal.get(jobId);
		if (existing) return Promise.resolve(existing);
		if (!this.running || timeoutMs <= 0) return Promise.resolve(null);

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				const pending = this.waiters.get(jobId);
				if (pending) {
					const remaining = pending.filter((w) => w !== onStatus);
					if (remaining.length > 0) this.waiters.set(jobId, remaining);
					else this.waiters.delete(jobId);
				}
				resolve(null);
			}, timeoutMs);

			const onStatus = (status: GhJobStatus) => {
				clearTimeout(timer);
				resolve(status);
			};

			const pending = this.waiters.get(jobId) ?? [];
			pending.push(onStatus);
			this.waiters.set(jobId, pending);
		});
	}
}

let _listener: JobStatusListener | null = null;

function getListener(): JobStatusListener {
	if (!_listener) _listener = new JobStatusListener();
	return _listener;
}

/** Start the shared listener before submitting jobs. Never throws. */
export async function ensureJobListenerStarted(): Promise<boolean> {
	return getListener().ensureStarted();
}

/**
 * Await terminal statuses for the given jobIds within a shared deadline.
 * Jobs that do not finish in time are simply absent from the returned map,
 * so callers degrade gracefully to jobId-only reporting.
 */
export async function waitForJobResults(
	jobIds: string[],
	timeoutMs: number,
): Promise<Map<string, GhJobStatus>> {
	const listener = getListener();
	const results = new Map<string, GhJobStatus>();
	if (jobIds.length === 0) return results;

	const deadline = Date.now() + timeoutMs;
	// Jobs execute sequentially in the plugin's queue; await them in order
	// against one shared deadline.
	for (const jobId of jobIds) {
		const remaining = deadline - Date.now();
		const status = await listener.waitForJob(jobId, Math.max(remaining, 0));
		if (status) results.set(jobId, status);
	}
	return results;
}
