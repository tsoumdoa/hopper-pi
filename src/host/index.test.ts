import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	connect: vi.fn(),
	closeRuntimeRpc: vi.fn(async () => { }),
	createRuntime: vi.fn(),
	startServer: vi.fn(),
	validateStaticDirectory: vi.fn(),
}));

vi.mock("../infra/runtime-rpc.js", () => ({
	getRuntimeRpc: () => ({ connect: mocks.connect }),
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
		mocks.closeRuntimeRpc.mockResolvedValue(undefined);
		mocks.validateStaticDirectory.mockImplementation((path: string) => path);
	});

	afterEach(() => {
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

	it("passes the completed handshake instance to the server and ready line", async () => {
		const handshake = {
			lifecycleInstanceId: "life-from-profile",
			protocolHandshakeLive: true,
		} as const;
		mocks.connect.mockResolvedValue(handshake);
		mocks.createRuntime.mockResolvedValue({ dispose: vi.fn(async () => { }) });
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
	});
});
