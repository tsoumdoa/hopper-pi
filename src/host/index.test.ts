import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ start: vi.fn(), validate: vi.fn(), ensure: vi.fn() }));
vi.mock("./shared/main.js", () => ({ startSharedHost: mocks.start }));
vi.mock("./shared/ensure-host.js", () => ({ ensureSharedHost: mocks.ensure }));
vi.mock("./server.js", () => ({ validateStaticDirectory: mocks.validate }));
import { main } from "./index.js";

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
it("normal startup uses the persistent host without an opt-in flag or native connection", async () => {
	await main([]);
	expect(mocks.start).toHaveBeenCalledOnce();
	expect(mocks.start.mock.calls[0]![1]).toEqual([]);
	expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]!);
});
it("launches without starting a runtime in the helper and preserves readiness messages and host options", async () => {
	const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	const discovery = { hostEpoch: "epoch", endpointPort: 12345 };
	mocks.ensure.mockImplementation(async options => {
		options.onBrowserReady(discovery);
		return discovery;
	});
	const args = ["--ensure-host", "--explicit-start", "--static-dir", "/static", "--data-dir", "/data"];
	await main(args);
	expect(mocks.start).not.toHaveBeenCalled();
	expect(mocks.ensure).toHaveBeenCalledWith(expect.objectContaining({
		explicitStart: true,
		dataDirectory: join("/data", "shared-host"),
		defaultDataDirectory: join("/data", "shared-host"),
		entrypoint: expect.stringMatching(/host[/\\]index\.(ts|js)$/),
		hostArguments: ["--static-dir", "/static", "--data-dir", "/data"],
	}));
	expect(output.mock.calls.map(call => JSON.parse(call[0] as string))).toEqual([
		{ type: "shared_browser_ready", hostEpoch: "epoch", port: 12345 },
		{ type: "shared_ready", hostEpoch: "epoch", port: 12345 },
	]);
});
it.each([{ args: [] }, { args: ["--ensure-host"] }])("refuses startup before touching shared control when the packaged UI is missing: $args", async ({ args }) => {
	mocks.validate.mockImplementation(() => { throw new Error("UI missing"); });
	await expect(main(args)).rejects.toThrow("UI missing");
	expect(mocks.start).not.toHaveBeenCalled();
	expect(mocks.ensure).not.toHaveBeenCalled();
});
it.each(["--parent-pid", "--instance-id", "--connection-profile"])("rejects legacy %s options before launching", async option => {
	await expect(main(["--ensure-host", option, "123"])).rejects.toThrow("per-process host options are no longer supported");
	expect(mocks.start).not.toHaveBeenCalled();
	expect(mocks.ensure).not.toHaveBeenCalled();
});
