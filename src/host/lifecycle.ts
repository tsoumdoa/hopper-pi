export type ParentWatcherOptions = {
	intervalMs?: number;
	isAlive?: (pid: number) => boolean;
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
	const timer = setInterval(() => {
		if (!isAlive(pid)) {
			clearInterval(timer);
			onGone();
		}
	}, options.intervalMs ?? 2_000);
	timer.unref();
	return () => clearInterval(timer);
}
