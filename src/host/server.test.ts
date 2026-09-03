import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { HostMessageBus } from "./message-bus.js";
import type { HostRuntime } from "./pi-runtime.js";
import type { HostSnapshot, ServerMessage } from "./protocol.js";
import { startHopperServer, type HopperServer } from "./server.js";
import type { RuntimeStatus } from "../protocol/v2.js";

const protocolHandshake = {
	lifecycleInstanceId: "life-server-test",
	protocolHandshakeLive: true,
} as const;

const runtimeStatus: RuntimeStatus = {
	protocolVersion: 2,
	revision: 7,
	observedAt: 123,
	lifecycle: { state: "running", changedAt: 100, reason: null },
	transport: { ready: true, lifecycleInstanceId: "life-server-test" },
	host: {
		state: "running",
		processId: 42,
		nodePath: "/usr/local/bin/node",
		nodeVersion: "22.19.0",
		handshake: "live",
		healthFailureCount: 0,
	},
	rhino: { activeDocument: true, documentName: "model.3dm" },
	grasshopper: { state: "ready", activeDocument: true, documentName: "definition.gh" },
	dispatcher: { acceptingExternalWork: true, depth: 2, capacity: 64 },
	errors: { transport: null, host: null, rhino: null, grasshopper: null, dispatcher: null },
};

const getRuntimeStatus = async () => runtimeStatus;

const tempDirs: string[] = [];
const servers: HopperServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function snapshot(): HostSnapshot {
	return {
		sessionId: "session-1",
		messages: [],
		isStreaming: false,
		thinkingLevel: "medium",
		availableThinkingLevels: ["off", "medium"],
		models: [],
		providers: [],
	};
}

function fakeRuntime(): HostRuntime {
	return {
		bus: new HostMessageBus(),
		ui: { replayPending: vi.fn(), respond: vi.fn(() => true) },
		snapshot,
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		newSession: vi.fn(async () => {}),
		setModel: vi.fn(async () => {}),
		setThinkingLevel: vi.fn(),
		login: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	};
}

async function staticDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "hopper-host-test-"));
	tempDirs.push(directory);
	await writeFile(join(directory, "index.html"), "<!doctype html><title>Hopper</title>");
	return directory;
}

function openSocket(server: HopperServer): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(
			`ws://${server.host}:${server.port}/ws`,
			{ headers: { Origin: `http://${server.host}:${server.port}` } },
		);
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
	return new Promise((resolve) => {
		socket.once("message", (data) => resolve(JSON.parse(data.toString()) as ServerMessage));
	});
}

describe("Hopper loopback server", () => {
	it("fails before listening when the web UI is missing", async () => {
		const directory = await mkdtemp(join(tmpdir(), "hopper-host-missing-ui-"));
		tempDirs.push(directory);
		await expect(startHopperServer({
			runtime: fakeRuntime(),
			staticDir: directory,
			protocolHandshake,
			getRuntimeStatus,
		}))
			.rejects.toThrow("web UI is missing");
	});

	it("serves health and static assets on loopback", async () => {
		const server = await startHopperServer({
			runtime: fakeRuntime(),
			staticDir: await staticDirectory(),
			protocolHandshake,
			getRuntimeStatus,
		});
		servers.push(server);

		await expect(fetch(`http://${server.host}:${server.port}/health`).then((response) => response.json()))
			.resolves.toEqual({
				ok: true,
				lifecycleInstanceId: "life-server-test",
				protocolHandshakeLive: true,
			});
		await expect(fetch(`http://${server.host}:${server.port}/`).then((response) => response.text()))
			.resolves.toContain("<title>Hopper</title>");
		expect(server.url).toBe(`http://127.0.0.1:${server.port}/#${server.token}`);
	});

	it("authenticates a socket, sends a snapshot, and dispatches commands", async () => {
		const runtime = fakeRuntime();
		const server = await startHopperServer({
			runtime,
			staticDir: await staticDirectory(),
			token: "known-token",
			protocolHandshake,
			getRuntimeStatus,
		});
		servers.push(server);
		const socket = await openSocket(server);

		const initial = nextMessage(socket);
		socket.send(JSON.stringify({ type: "authenticate", token: server.token }));
		await expect(initial).resolves.toEqual({ type: "snapshot", snapshot: snapshot() });
		socket.send(JSON.stringify({ type: "prompt", text: "make a loft" }));
		await vi.waitFor(() => expect(runtime.prompt).toHaveBeenCalledWith("make a loft"));

		const event = nextMessage(socket);
		runtime.bus.publish({ type: "ui_notification", message: "online", level: "info" });
		await expect(event).resolves.toEqual({ type: "ui_notification", message: "online", level: "info" });
		socket.close();
	});

	it("rejects the wrong browser origin or token", async () => {
		const server = await startHopperServer({
			runtime: fakeRuntime(),
			staticDir: await staticDirectory(),
			token: "right",
			protocolHandshake,
			getRuntimeStatus,
		});
		servers.push(server);

		const socket = await openSocket(server);
		const status = await new Promise<number>((resolve) => {
			socket.once("close", (code) => resolve(code));
			socket.send(JSON.stringify({ type: "authenticate", token: "wrong" }));
		});
		expect(status).toBe(4003);
	});

	it("requires the bearer token for a graceful shutdown request", async () => {
		const onShutdownRequest = vi.fn();
		const server = await startHopperServer({
			runtime: fakeRuntime(),
			staticDir: await staticDirectory(),
			token: "shutdown-token",
			protocolHandshake,
			getRuntimeStatus,
			onShutdownRequest,
		});
		servers.push(server);
		const endpoint = `http://${server.host}:${server.port}/api/shutdown`;

		await expect(fetch(endpoint, { method: "POST" })).resolves.toMatchObject({ status: 403 });
		expect(onShutdownRequest).not.toHaveBeenCalled();
		await expect(fetch(endpoint, {
			method: "POST",
			headers: { Authorization: "Bearer shutdown-token" },
		})).resolves.toMatchObject({ status: 202 });
		await vi.waitFor(() => expect(onShutdownRequest).toHaveBeenCalledOnce());
	});

	it("rejects a WebSocket from another browser origin", async () => {
		const server = await startHopperServer({
			runtime: fakeRuntime(),
			staticDir: await staticDirectory(),
			protocolHandshake,
			getRuntimeStatus,
		});
		servers.push(server);
		const status = await new Promise<number>((resolve) => {
			const socket = new WebSocket(`ws://${server.host}:${server.port}/ws`, {
				headers: { Origin: "http://attacker.invalid" },
			});
			socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
		});
		expect(status).toBe(403);
	});

	it("returns Rhino's runtime snapshot unchanged only to an authenticated request", async () => {
		const readStatus = vi.fn(async () => runtimeStatus);
		const server = await startHopperServer({
			runtime: fakeRuntime(),
			staticDir: await staticDirectory(),
			token: "runtime-token",
			protocolHandshake,
			getRuntimeStatus: readStatus,
		});
		servers.push(server);
		const endpoint = `http://${server.host}:${server.port}/api/runtime-status`;

		await expect(fetch(endpoint)).resolves.toMatchObject({ status: 403 });
		expect(readStatus).not.toHaveBeenCalled();
		const response = await fetch(endpoint, {
			headers: { Authorization: "Bearer runtime-token" },
		});
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(runtimeStatus);
		expect(readStatus).toHaveBeenCalledOnce();
		await expect(fetch(endpoint, {
			method: "POST",
			headers: { Authorization: "Bearer runtime-token" },
		})).resolves.toMatchObject({ status: 405 });
	});
});
