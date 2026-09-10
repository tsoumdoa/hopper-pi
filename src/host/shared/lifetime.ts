/** Watch process lifetime independently of network refresh and bounded cleanup. */
export function monitorHostLifetime(options: {
	shouldStop(): boolean;
	close(): Promise<void>;
	exit(code: number): void;
	log(message: string): void;
}): () => void {
	let stopped = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const timer = setInterval(() => {
		if (stopped || !options.shouldStop()) return;
		stopped = true;
		clearInterval(timer);
		options.log("No Hopper Rhino processes remain; shutting down");
		deadline = setTimeout(() => {
			options.log("Host cleanup exceeded 5 seconds; exiting");
			options.exit(1);
		}, 5_000);
		void Promise.resolve().then(() => options.close()).then(() => {
			clearTimeout(deadline);
			options.exit(0);
		}, (error: unknown) => {
			clearTimeout(deadline);
			options.log(`Host cleanup failed: ${String(error)}`);
			options.exit(1);
		});
	}, 1_000);
	return () => {
		stopped = true;
		clearInterval(timer);
		// An exit already in progress must retain its cleanup deadline.
	};
}
