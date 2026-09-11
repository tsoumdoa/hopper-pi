import { afterEach, expect, it, vi } from "vitest";
import { createStartupGate } from "./startup-gate.js";

afterEach(() => vi.useRealTimers());

it.each(["launcher", "browser"])("waits for both handshake participants, %s first", async first => {
	vi.useFakeTimers();
	const gate = createStartupGate();
	let imported = false;
	const ready = gate.wait().then(() => { imported = true; });
	(first === "launcher" ? gate.launcherReady : gate.browserReady)();
	await Promise.resolve();
	expect(imported).toBe(false);
	(first === "launcher" ? gate.browserReady : gate.launcherReady)();
	await ready;
	expect(imported).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it("bounds abandoned launches without requiring a browser", async () => {
	vi.useFakeTimers();
	const gate = createStartupGate();
	const ready = vi.fn();
	void gate.wait().then(ready);
	await vi.advanceTimersByTimeAsync(1999);
	expect(ready).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(ready).toHaveBeenCalledOnce();
});
