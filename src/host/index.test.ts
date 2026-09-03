import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	lifecycleInstanceId: "life-from-profile",
	connect: vi.fn(),
	getRuntimeStatus: vi.fn(),
	subscribeNotices: vi.fn(),
	closeRuntimeRpc: vi.fn(async () => { }),
	createRuntime: vi.fn(),
	startServer: vi.fn(),
	validateStaticDirectory: vi.fn(),
}));

vi.mock("../infra/runtime-rpc.js", () => ({
	getRuntimeRpc: () => ({
		get lifecycleInstanceId() { return mocks.lifecycleInstanceId; },
		connect: mocks.connect,
		getRuntimeStatus: mocks.getRuntimeStatus,
		subscribeNotices: mocks.subscribeNotices,
	}),
	closeRuntimeRpc: mocks.closeRuntimeRpc,
}));

vi.mock("./pi-runtime.js", () => ({
	EmbeddedPiHost: { create: mocks.createRuntime },
}));

vi.mock("./server.js", () => ({
	startHopperServer: mocks.startServer,
	validateStaticDirectory: mocks.validateStaticDirectory,
}));

import { main } from "./index.js";

describe("host protocol startup", () => {
	let originalProfile: string | undefined;
	let originalExitCode: typeof process.exitCode;
	let originalSigint: Set<NodeJS.SignalsListener>;
	let originalSigterm: Set<NodeJS.SignalsListener>;

	beforeEach(() => {
		originalProfile = process.env.HOPPER_CONNECTION_PROFILE;
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		originalSigint = new Set(process.listeners("SIGINT"));
		originalSigterm = new Set(process.listeners("SIGTERM"));
		vi.clearAllMocks();
		mocks.lifecycleInstanceId = "life-from-profile";
		mocks.closeRuntimeRpc.mockResolvedValue(undefined);
		mocks.subscribeNotices.mockReturnValue(() => { });
		mocks.validateStaticDirectory.mockImplementation((path: string) => path);
	});

	afterEach(() => {
		vi.useRealTimers();
		if (originalProfile === undefined) delete process.env.HOPPER_CONNECTION_PROFILE;
		else process.env.HOPPER_CONNECTION_PROFILE = originalProfile;
		process.exitCode = originalExitCode;
		for (const listener of process.listeners("SIGINT")) {
			if (!originalSigint.has(listener)) process.removeListener("SIGINT", listener);
		}
		for (const listener of process.listeners("SIGTERM")) {
			if (!originalSigterm.has(listener)) process.removeListener("SIGTERM", listener);
		}
		vi.restoreAllMocks();
	});

	it("arms the parent-loss deadline while the protocol handshake is still blocked", async () => {
		vi.useFakeTimers();
		mocks.connect.mockReturnValue(new Promise(() => { }));
		mocks.closeRuntimeRpc.mockReturnValue(new Promise(() => { }));
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		void main([
			"--instance-id", "host-instance",
			"--connection-profile", "/profiles/current.json",
			"--static-dir", "/static",
			"--parent-pid", "2147483647",
		]);

		await vi.advanceTimersByTimeAsync(1_999);
		expect(exit).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(749);
		expect(exit).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		expect(exit).toHaveBeenCalledWith(0);
		expect(mocks.createRuntime).not.toHaveBeenCalled();
		expect(mocks.startServer).not.toHaveBeenCalled();
	});

	it("does not create the host or print ready when the protocol handshake fails", async () => {
		mocks.connect.mockRejectedValue(new Error("handshake rejected"));
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await main([
			"--instance-id", "host-instance",
			"--connection-profile", "/profiles/current.json",
			"--static-dir", "/static",
		]);

		expect(mocks.createRuntime).not.toHaveBeenCalled();
		expect(mocks.startServer).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
		expect(mocks.closeRuntimeRpc).toHaveBeenCalledOnce();
		expect(process.exitCode).toBe(1);
	});

	it.each([
		{
			name: "non-live",
			handshake: { lifecycleInstanceId: "life-from-profile", protocolHandshakeLive: false },
		},
		{
			name: "stale",
			handshake: { lifecycleInstanceId: "life-stale", protocolHandshakeLive: true },
		},
	])("does not report ready for a $name handshake result", async ({ handshake }) => {
		mocks.connect.mockResolvedValue(handshake);
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await main([
			"--instance-id", "host-instance",
			"--connection-profile", "/profiles/current.json",
			"--static-dir", "/static",
		]);

		expect(mocks.createRuntime).not.toHaveBeenCalled();
		expect(mocks.startServer).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it("passes the completed handshake instance to the server and ready line", async () => {
		const handshake = {
			lifecycleInstanceId: "life-from-profile",
			protocolHandshakeLive: true,
		} as const;
		mocks.connect.mockResolvedValue(handshake);
		const publish = vi.fn();
		mocks.createRuntime.mockResolvedValue({
			dispose: vi.fn(async () => { }),
			bus: { publish },
		});
		mocks.startServer.mockResolvedValue({
			url: "http://127.0.0.1:4321/#token",
			lifecycleInstanceId: handshake.lifecycleInstanceId,
			protocolHandshakeLive: true,
			close: vi.fn(async () => { }),
		});
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await main([
			"--instance-id", "host-instance",
			"--connection-profile", "/profiles/current.json",
			"--static-dir", "/static",
		]);

		expect(mocks.startServer).toHaveBeenCalledWith(expect.objectContaining({
			protocolHandshake: handshake,
			getRuntimeStatus: expect.any(Function),
		}));
		expect(mocks.connect.mock.invocationCallOrder[0])
			.toBeLessThan(mocks.startServer.mock.invocationCallOrder[0]!);
		const ready = JSON.parse(String(stdout.mock.calls[0]?.[0]));
		expect(ready).toEqual({
			type: "ready",
			url: "http://127.0.0.1:4321/#token",
			pid: process.pid,
			lifecycleInstanceId: "life-from-profile",
			protocolHandshakeLive: true,
		});

		const noticeListener = mocks.subscribeNotices.mock.calls[0]?.[0];
		noticeListener({
			type: "grasshopper_starting",
			level: "warning",
			message: "Grasshopper may open and create an untitled document.",
		});
		expect(publish).toHaveBeenCalledWith({
			type: "ui_notification",
			level: "warning",
			message: "Grasshopper may open and create an untitled document.",
		});
	});
});
