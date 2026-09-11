/** All shutdown callers share one deadline, including signals and Stop Host. */
export function createHostShutdown(options: {
	cleanup(): Promise<void>;
	exit(code: number): void;
	log(message: string): void;
}): () => Promise<void> {
	let closing: Promise<void> | undefined;
	return () => {
		if (closing) return closing;
		const deadline = setTimeout(() => {
			options.log("Host cleanup exceeded 5 seconds; exiting with unresolved work preserved for recovery");
			options.exit(1);
		}, 5_000);
		closing = Promise.resolve().then(options.cleanup).then(() => {
			clearTimeout(deadline);
			options.exit(0);
		}, (error: unknown) => {
			clearTimeout(deadline);
			options.log(`Host cleanup failed: ${String(error)}`);
			options.exit(1);
		});
		return closing;
	};
}

/** Watch process lifetime independently of network refresh. */
export function monitorHostLifetime(options: {
	shouldStop(): boolean;
	close(): Promise<void>;
	log(message: string): void;
}): () => void {
	let stopped = false;
	const timer = setInterval(() => {
		if (stopped || !options.shouldStop()) return;
		stopped = true;
		clearInterval(timer);
		options.log("No Hopper Rhino processes remain; shutting down");
		void options.close();
	}, 1_000);
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
