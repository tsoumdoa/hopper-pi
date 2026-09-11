/** Keep one snapshot in flight and only the newest replacement for a slow browser. */
export function createSnapshotSender(send: (event: unknown, done: (error?: Error) => void) => void) {
	let sending = false;
	let pending: unknown;
	let closed = false;
	const push = (event: unknown) => {
		if (closed) return;
		if (sending) {
			pending = event;
			return;
		}
		sending = true;
		send(event, (error) => {
			sending = false;
			if (error) closed = true;
			const next = pending;
			pending = undefined;
			if (!closed && next !== undefined) push(next);
		});
	};
	return { push, close: () => { closed = true; pending = undefined; } };
}
