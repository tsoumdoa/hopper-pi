import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../config.js";
import {
	clearConnectionCache,
	resolveConnection,
} from "./connection.js";

describe("RPC v2 connection profiles", () => {
	let directory: string;
	let originalProfile: string | undefined;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "hopper-connection-"));
		originalProfile = process.env[ENV.HOPPER_CONNECTION_PROFILE];
		clearConnectionCache();
	});

	afterEach(() => {
		if (originalProfile === undefined) delete process.env[ENV.HOPPER_CONNECTION_PROFILE];
		else process.env[ENV.HOPPER_CONNECTION_PROFILE] = originalProfile;
		clearConnectionCache();
		rmSync(directory, { recursive: true, force: true });
	});

	it("loads the authoritative lifecycle, endpoints, and authentication data", () => {
		const profilePath = writeProfile({
			protocolVersion: 2,
			lifecycleInstanceId: "life-profile-1",
			endpoints: {
				rpcEndpoint: "tcp://127.0.0.1:32001",
				pubEndpoint: "tcp://127.0.0.1:32002",
			},
			authentication: { token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" },
		});

		const connection = resolveConnection();

		expect(connection).toEqual({
			rpcEndpoint: "tcp://127.0.0.1:32001",
			pubEndpoint: "tcp://127.0.0.1:32002",
			token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
			lifecycleInstanceId: "life-profile-1",
			profilePath,
			source: "profile",
		});
	});

	it("does not fall back to the legacy REQ/PUSH profile", () => {
		const profilePath = writeProfile({
			protocolVersion: 1,
			instanceId: "legacy",
			reqEndpoint: "tcp://127.0.0.1:5557",
			pushEndpoint: "tcp://127.0.0.1:5556",
			pubEndpoint: "tcp://127.0.0.1:5555",
			token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
		});

		expect(() => resolveConnection()).toThrow(
			`RPC v2 connection profile is missing or invalid: ${profilePath}`,
		);
	});

	function writeProfile(profile: object): string {
		const profilePath = join(directory, "connection.json");
		writeFileSync(profilePath, JSON.stringify(profile));
		process.env[ENV.HOPPER_CONNECTION_PROFILE] = profilePath;
		return profilePath;
	}
});
