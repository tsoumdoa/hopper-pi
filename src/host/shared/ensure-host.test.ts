import { afterEach, describe, expect, it, vi } from "vitest";
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
	it.each([21_000, Infinity])("bounds cold startup while allowing readiness after 15 seconds: %s", async readyAfter => {
		const options = setup();
		const startedAt = Date.now();
		let now = startedAt;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
		const onBrowserReady = vi.fn();
		let spawns = 0;
		try {
			const waiting = ensureSharedHost({
				...options, explicitStart: true, onBrowserReady,
				spawnHost: async state => {
					spawns++;
					const discovery: HostDiscovery = {
						endpointPort: state.endpointPort, dataDirectory: state.dataDirectory,
						journalIdentity: state.journalIdentity, revision: state.revision,
						hostEpoch: "cold-host", pid: 123, processStartIdentity: "start",
						protocolVersion: 2, schemaVersion: 2, registrationToken: "private",
					};
					const server = createServer((_request, response) => {
						now += 8000; // Advance elapsed startup time without slowing the test.
						response.end(JSON.stringify({ ...discovery, listening: true, ready: now - startedAt >= readyAfter }));
					});
					servers.push(server);
					await options.control.acquireOwnership(server, state.revision);
					await options.control.publish(discovery);
				},
			});
			if (Number.isFinite(readyAfter)) {
				await expect(waiting).resolves.toMatchObject({ hostEpoch: "cold-host" });
				expect(now - startedAt).toBeGreaterThan(15_000);
			} else {
				await expect(waiting).rejects.toThrow("did not become ready within 60 seconds");
			}
			expect(spawns).toBe(1);
			expect(onBrowserReady).toHaveBeenCalledOnce();
		} finally { clock.mockRestore(); }
	});
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
					response.end(JSON.stringify({ ...discovery, ready: true })),
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
				timeoutMs: 150,
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
	it.each([true, false])("waits for the previous host to drain before replacing it, intentional stop: %s", async (intentional) => {
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
			response.end(JSON.stringify({ ...discovery, ready: intentional })),
		);
		servers.push(old);
		await options.control.acquireOwnership(old, first.revision);
		await options.control.publish(discovery);
		if (intentional) await options.control.setDesiredState("stopped", first.revision);
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
						response.end(JSON.stringify({ ...next, ready: true })),
					);
					servers.push(server);
					await options.control.acquireOwnership(server, state.revision);
					await options.control.publish(next);
				},
			});
			expect(result.hostEpoch).toBe("new");
			expect(result.revision).toBe(intentional ? 3 : 1);
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
			response.end(JSON.stringify({ ...discovery, ready: true })),
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

it("lets a second Rhino join the winner while it has bound HTTP but not published readiness", async () => {
	const options = setup();
	let bound!: () => void;
	const listening = new Promise<void>((resolve) => { bound = resolve; });
	let publish!: () => void;
	const release = new Promise<void>((resolve) => { publish = resolve; });
	let spawns = 0;
	const first = ensureSharedHost({
		...options, explicitStart: true, timeoutMs: 2000,
		spawnHost: async (state) => {
			spawns++;
			const discovery: HostDiscovery = {
				endpointPort: state.endpointPort, dataDirectory: state.dataDirectory,
				journalIdentity: state.journalIdentity, revision: state.revision,
				hostEpoch: "shared-winner", pid: 123, processStartIdentity: "start",
				protocolVersion: 2, schemaVersion: 2, registrationToken: "private",
			};
			let ready = false;
			const server = createServer((_request, response) => response.end(JSON.stringify({ ...discovery, ready, listening: true })));
			servers.push(server);
			await options.control.acquireOwnership(server, state.revision);
			await options.control.publish(discovery);
			bound();
			await release;
			ready = true;
			await options.control.publish(discovery);
		},
	});
	await listening;
	const onBrowserReady = vi.fn();
	let completed = false;
	const second = ensureSharedHost({ ...options, explicitStart: true, timeoutMs: 2000, onBrowserReady, spawnHost: async () => { spawns++; } });
	void second.then(() => { completed = true; });
	try {
		await vi.waitFor(() => expect(onBrowserReady).toHaveBeenCalledOnce());
		expect(completed).toBe(false);
		expect(onBrowserReady.mock.calls[0]![0].hostEpoch).toBe("shared-winner");
		publish();
		const [a, b] = await Promise.all([first, second]);
		expect(b).toEqual(a);
		expect(b.hostEpoch).toBe("shared-winner");
		expect(spawns).toBe(1);
		expect(onBrowserReady).toHaveBeenCalledOnce();
	} finally { publish(); await first; }
});

it("honors Stop while another Rhino waits for the initializing owner", async () => {
	const options = setup();
	const state = await options.control.initialize(options);
	const server = createServer((_request, response) => response.end(JSON.stringify({ ready: false })));
	servers.push(server);
	await options.control.acquireOwnership(server, state.revision);
	let spawns = 0;
	const waiting = ensureSharedHost({ ...options, timeoutMs: 2000, spawnHost: async () => { spawns++; } });
	await new Promise((resolve) => setTimeout(resolve, 100));
	await options.control.setDesiredState("stopped", state.revision);
	await expect(waiting).rejects.toThrow("superseded");
	expect(spawns).toBe(0);
	expect(server.listening).toBe(true);
});
