export const PARENT_POLL_INTERVAL_MS = 2_000;
export const NORMAL_SHUTDOWN_FORCE_EXIT_MS = 5_000;
export const PARENT_GONE_FORCE_EXIT_MS = 750;

export interface UnrefTimer {
	unref(): void;
}

export interface HostTimerApi {
	setTimeout(callback: () => void, delayMs: number): UnrefTimer;
	clearTimeout(timer: UnrefTimer): void;
	setInterval(callback: () => void, intervalMs: number): UnrefTimer;
	clearInterval(timer: UnrefTimer): void;
}

const systemTimers: HostTimerApi = {
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
	setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
	clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
};

export type ParentWatcherOptions = {
	intervalMs?: number;
	isAlive?: (pid: number) => boolean;
	timers?: HostTimerApi;
};

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function watchParentProcess(
	pid: number | undefined,
	onGone: () => void,
	options: ParentWatcherOptions = {},
): () => void {
	if (pid === undefined) return () => {};
	const isAlive = options.isAlive ?? isProcessAlive;
	const timers = options.timers ?? systemTimers;
	const timer = timers.setInterval(() => {
		if (!isAlive(pid)) {
			timers.clearInterval(timer);
			onGone();
		}
	}, options.intervalMs ?? PARENT_POLL_INTERVAL_MS);
	timer.unref();
	return () => timers.clearInterval(timer);
}

export type ShutdownCause = "normal" | "parent_gone";

export type HostShutdownCoordinatorOptions = {
	cleanup: () => Promise<void>;
	exit: (code: number) => void;
	getExitCode: () => number;
	setExitCode: (code: number) => void;
	reportError: (error: unknown) => void;
	timers?: HostTimerApi;
	normalForceExitMs?: number;
	parentGoneForceExitMs?: number;
};

export class HostShutdownCoordinator {
	private readonly timers: HostTimerApi;
	private readonly normalForceExitMs: number;
	private readonly parentGoneForceExitMs: number;
	private cleanupPromise: Promise<void> | undefined;
	private normalForceExit: UnrefTimer | undefined;
	private parentGoneForceExit: UnrefTimer | undefined;
	private parentGone = false;
	private settled = false;
	private exited = false;

	constructor(private readonly options: HostShutdownCoordinatorOptions) {
		this.timers = options.timers ?? systemTimers;
		this.normalForceExitMs = options.normalForceExitMs ?? NORMAL_SHUTDOWN_FORCE_EXIT_MS;
		this.parentGoneForceExitMs = options.parentGoneForceExitMs ?? PARENT_GONE_FORCE_EXIT_MS;
		if (this.normalForceExitMs <= 0) {
			throw new RangeError("Normal shutdown force-exit delay must be positive.");
		}
		if (this.parentGoneForceExitMs <= 0 || this.parentGoneForceExitMs >= 1_000) {
			throw new RangeError("Parent-gone force-exit delay must be positive and below one second.");
		}
	}

	request(cause: ShutdownCause): Promise<void> {
		if (cause === "parent_gone") this.markParentGone();
		else this.armNormalForceExit();

		if (!this.cleanupPromise) {
			let cleanup: Promise<void>;
			try {
				cleanup = this.options.cleanup();
			} catch (error) {
				cleanup = Promise.reject(error);
			}
			this.cleanupPromise = cleanup
				.then(() => this.finish(true))
				.catch((error) => {
					this.options.reportError(error);
					this.options.setExitCode(1);
					this.finish(false);
				});
		}
		if (this.parentGone && this.settled) this.exitNow();
		return this.cleanupPromise;
	}

	private markParentGone(): void {
		if (this.parentGone) return;
		this.parentGone = true;
		if (this.settled) {
			this.exitNow();
			return;
		}
		this.parentGoneForceExit = this.armForceExit(this.parentGoneForceExitMs);
	}

	private armNormalForceExit(): void {
		if (this.parentGone || this.normalForceExit || this.settled) return;
		this.normalForceExit = this.armForceExit(this.normalForceExitMs);
	}

	private armForceExit(delayMs: number): UnrefTimer {
		const timer = this.timers.setTimeout(() => this.exitNow(), delayMs);
		timer.unref();
		return timer;
	}

	private finish(clean: boolean): void {
		this.settled = true;
		if (clean && this.normalForceExit) {
			this.timers.clearTimeout(this.normalForceExit);
			this.normalForceExit = undefined;
		}
		if (this.parentGone) this.exitNow();
	}

	private exitNow(): void {
		if (this.exited) return;
		this.exited = true;
		if (this.normalForceExit) this.timers.clearTimeout(this.normalForceExit);
		if (this.parentGoneForceExit) this.timers.clearTimeout(this.parentGoneForceExit);
		this.options.exit(this.options.getExitCode());
	}
}
