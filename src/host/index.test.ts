import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), validate: vi.fn() }));
vi.mock("./shared/main.js", () => ({ startSharedHost: mocks.start }));
vi.mock("./server.js", () => ({ validateStaticDirectory: mocks.validate }));
import { main } from "./index.js";

beforeEach(() => { vi.resetAllMocks(); });
it("normal startup uses the persistent host without an opt-in flag or native connection", async () => {
	await main([]);
	expect(mocks.start).toHaveBeenCalledOnce();
	expect(mocks.start.mock.calls[0]![1]).toEqual([]);
	expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]!);
});
it("keeps the detached launch helper on the same default startup path", async () => {
	const args = ["--ensure-host", "--explicit-start", "--static-dir", "/static"];
	await main(args);
	expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ paths: expect.objectContaining({ staticDir: "/static" }) }), args, expect.stringMatching(/host[/\\]index\.(ts|js)$/));
});
it("refuses startup before touching shared control when the packaged UI is missing", async () => {
	mocks.validate.mockImplementation(() => { throw new Error("UI missing"); });
	await expect(main([])).rejects.toThrow("UI missing");
	expect(mocks.start).not.toHaveBeenCalled();
});
