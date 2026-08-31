import { afterEach, describe, expect, it, vi } from "vitest";
import { watchParentProcess } from "./lifecycle.js";

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
});
