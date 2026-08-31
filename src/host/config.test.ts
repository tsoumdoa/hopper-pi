import { describe, expect, it } from "vitest";
import { defaultDataDirectory, resolveHostConfig } from "./config.js";

describe("host config", () => {
	it("uses a private platform application directory", () => {
		expect(defaultDataDirectory({ platform: "darwin", homeDir: "/Users/test" }))
			.toBe("/Users/test/Library/Application Support/hopper-pi/host");
		expect(defaultDataDirectory({
			platform: "linux",
			homeDir: "/home/test",
			env: { XDG_DATA_HOME: "/data" },
		})).toBe("/data/hopper-pi/host");
	});

	it("derives all Pi state below the configured data directory", () => {
		const config = resolveHostConfig([
			"--data-dir", "private",
			"--instance-id", "rhino-42-backend",
			"--connection-profile", "rhino.json",
			"--parent-pid", "42",
		], { cwd: "/work", moduleDir: "/app/host" });

		expect(config.paths).toEqual({
			dataDir: "/work/private",
			agentDir: "/work/private/agent",
			sessionsDir: "/work/private/instances/rhino-42-backend/sessions",
			workspaceDir: "/work/private/instances/rhino-42-backend/workspace",
			staticDir: "/app/host/static",
		});
		expect(config.connectionProfile).toBe("/work/rhino.json");
		expect(config.instanceId).toBe("rhino-42-backend");
		expect(config.parentPid).toBe(42);
		expect(config.host).toBe("127.0.0.1");
	});

	it("rejects unsafe ports and malformed process ids", () => {
		expect(() => resolveHostConfig(["--port", "65536"])).toThrow("between 0 and 65535");
		expect(() => resolveHostConfig(["--parent-pid", "nope"])).toThrow("must be an integer");
		expect(() => resolveHostConfig(["--instance-id", "../shared"])).toThrow("only letters");
	});
});
