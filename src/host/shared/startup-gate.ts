/** Let the launcher announce the verified owner and the browser fetch its UI before
 * synchronous SDK imports occupy the event loop. The deadline handles abandoned
 * launches and browsers that cannot connect; it is not a startup delay. */
export function createStartupGate(timeoutMs = 2_000) {
	let launcher = false;
	let browser = false;
	let release!: () => void;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const ready = new Promise<void>(resolve => { release = resolve; });
	const finish = () => { clearTimeout(timer); release(); };
	const check = () => { if (launcher && browser) finish(); };
	return {
		launcherReady: () => { launcher = true; check(); },
		browserReady: () => { browser = true; check(); },
		wait: () => {
			if (!(launcher && browser)) timer ??= setTimeout(finish, timeoutMs);
			return ready;
		},
		close: finish,
	};
}
