import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { SharedHostControl, type HostDiscovery } from "./control.js";
import { ensureSharedHost } from "./ensure-host.js";
const roots: string[] = [],
	servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		if (server.listening)
			await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	roots
		.splice(0)
		.forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function setup() {
	const root = mkdtempSync(join(tmpdir(), "hopper-ensure-"));
	roots.push(root);
	return {
		control: new SharedHostControl(join(root, "control")),
		defaultDataDirectory: join(root, "data"),
		entrypoint: "unused",
	};
}
describe("detached shared host launcher", () => {
	it("reuses verified readiness without spawning and leaves its revision unchanged", async () => {
		const options = setup();
		let spawns = 0;
		const discovery = await ensureSharedHost({
			...options,
			explicitStart: true,
			spawnHost: async (state) => {
				spawns++;
				const discovery: HostDiscovery = {
					endpointPort: state.endpointPort,
					dataDirectory: state.dataDirectory,
					journalIdentity: state.journalIdentity,
					revision: state.revision,
					hostEpoch: "epoch",
					pid: 123,
					processStartIdentity: "start",
					protocolVersion: 2,
					schemaVersion: 2,
					registrationToken: "private",
				};
				const server = createServer((_request, response) =>
					response.end(JSON.stringify(discovery)),
				);
				servers.push(server);
				await options.control.acquireOwnership(server, state.revision);
				await options.control.publish(discovery);
			},
		});
		expect(
			await ensureSharedHost({
				...options,
				explicitStart: true,
				spawnHost: async () => {
					spawns++;
				},
			}),
		).toEqual(discovery);
		expect(spawns).toBe(1);
		expect((await options.control.snapshot())!.revision).toBe(1);
	});
	it("does not spawn when an unrelated or hung server occupies the assigned endpoint", async () => {
		const options = setup();
		const state = await options.control.initialize(options);
		const server = createServer((_request, response) =>
			response.end("unrelated"),
		);
		servers.push(server);
		await options.control.acquireOwnership(server, state.revision);
		let spawned = false;
		await expect(
			ensureSharedHost({
				...options,
				spawnHost: async () => {
					spawned = true;
				},
			}),
		).rejects.toThrow("occupied");
		expect(spawned).toBe(false);
	});
	it("observes a stop committed while a detached candidate is starting", async () => {
		const options = setup();
		await expect(
			ensureSharedHost({
				...options,
				spawnHost: async (state) => {
					await options.control.setDesiredState("stopped", state.revision);
				},
			}),
		).rejects.toThrow("superseded");
		expect((await options.control.snapshot())!.desiredState).toBe("stopped");
	});
	it("lets an explicit start wait for its known prior host to drain without stealing ownership", async () => {
		const options = setup();
		const first = await options.control.initialize(options);
		const discovery: HostDiscovery = {
			endpointPort: first.endpointPort,
			dataDirectory: first.dataDirectory,
			journalIdentity: first.journalIdentity,
			revision: first.revision,
			hostEpoch: "old",
			pid: 123,
			processStartIdentity: "old-start",
			protocolVersion: 2,
			schemaVersion: 2,
			registrationToken: "private",
		};
		const old = createServer((_request, response) =>
			response.end(JSON.stringify(discovery)),
		);
		servers.push(old);
		await options.control.acquireOwnership(old, first.revision);
		await options.control.publish(discovery);
		await options.control.setDesiredState("stopped", first.revision);
		const timer = setTimeout(() => {
			old.closeAllConnections();
			old.close();
		}, 150);
		let spawns = 0;
		try {
			const result = await ensureSharedHost({
				...options,
				explicitStart: true,
				timeoutMs: 2000,
				spawnHost: async (state) => {
					spawns++;
					const next = {
						...discovery,
						revision: state.revision,
						hostEpoch: "new",
					};
					const server = createServer((_request, response) =>
						response.end(JSON.stringify(next)),
					);
					servers.push(server);
					await options.control.acquireOwnership(server, state.revision);
					await options.control.publish(next);
				},
			});
			expect(result.hostEpoch).toBe("new");
			expect(result.revision).toBe(3);
			expect(spawns).toBe(1);
		} finally {
			clearTimeout(timer);
		}
	});
	it("times out a known hung prior owner without spawning", async () => {
		const options = setup();
		const first = await options.control.initialize(options);
		const discovery: HostDiscovery = {
			endpointPort: first.endpointPort,
			dataDirectory: first.dataDirectory,
			journalIdentity: first.journalIdentity,
			revision: first.revision,
			hostEpoch: "old",
			pid: 123,
			processStartIdentity: "old-start",
			protocolVersion: 2,
			schemaVersion: 2,
			registrationToken: "private",
		};
		const old = createServer((_request, response) =>
			response.end(JSON.stringify(discovery)),
		);
		servers.push(old);
		await options.control.acquireOwnership(old, first.revision);
		await options.control.publish(discovery);
		await options.control.setDesiredState("stopped", first.revision);
		let spawned = false;
		await expect(
			ensureSharedHost({
				...options,
				explicitStart: true,
				timeoutMs: 150,
				spawnHost: async () => {
					spawned = true;
				},
			}),
		).rejects.toThrow("draining or hung");
		expect(spawned).toBe(false);
		expect(old.listening).toBe(true);
	});
	it("does not let a queued retry resurrect intentional stop", async () => {
		const options = setup();
		const state = await options.control.initialize(options);
		await options.control.setDesiredState("stopped", state.revision);
		await expect(
			ensureSharedHost({
				...options,
				spawnHost: async () => {
					throw new Error("must not spawn");
				},
			}),
		).rejects.toThrow("intentionally stopped");
	});
});
