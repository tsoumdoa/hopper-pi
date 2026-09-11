import { expect, it, vi } from "vitest";
import { createSnapshotSender } from "./snapshot-sender.js";

it("bounds a slow browser to one in-flight snapshot and the newest replacement", () => {
	const completions: ((error?: Error) => void)[] = [];
	const send = vi.fn((_event: unknown, done: (error?: Error) => void) => completions.push(done));
	const sender = createSnapshotSender(send);
	for (let revision = 0; revision < 1000; revision++) sender.push({ revision });
	expect(send).toHaveBeenCalledTimes(1);
	completions.shift()!();
	expect(send).toHaveBeenCalledTimes(2);
	expect(send.mock.calls[1]![0]).toEqual({ revision: 999 });
	completions.shift()!();
	expect(send).toHaveBeenCalledTimes(2);
});

it.each(["disconnect", "send error"])("discards pending history on %s", (reason) => {
	let done!: (error?: Error) => void;
	const send = vi.fn((_event: unknown, callback: typeof done) => { done = callback; });
	const sender = createSnapshotSender(send);
	sender.push({ revision: 1 });
	sender.push({ revision: 2 });
	if (reason === "disconnect") sender.close();
	done(reason === "send error" ? new Error("closed") : undefined);
	sender.push({ revision: 3 });
	expect(send).toHaveBeenCalledTimes(1);
});
