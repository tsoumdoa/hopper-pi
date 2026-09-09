import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { createSharedBrowserServer } from "./browser-server.js";
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(
	snapshot: () => unknown = () => ({ events: [{ id: 7 }], tasks: [] }),
	ui: Partial<Parameters<typeof createSharedBrowserServer>[0]> = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "hopper-shared-server-"));
	writeFileSync(join(dir, "index.html"), "<html>Hopper</html>");
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const command = vi.fn(async () => ({ taskId: "t" }));
	const backend = { snapshot, command, subscribe: () => () => {} };
	const host = createSharedBrowserServer({
		backend,
		browserCredential: "secret",
		staticDir: dir,
		...ui,
	});
	await new Promise<void>((resolve) =>
		host.server.listen(0, "127.0.0.1", resolve),
	);
	cleanup.push(() => host.close());
	const port = (host.server.address() as { port: number }).port;
	const connect = async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws-shared`, {
			origin: `http://127.0.0.1:${port}`,
		});
		await new Promise<void>((resolve) => socket.once("open", resolve));
		return socket;
	};
	return { connect, command, port };
}
const next = (socket: WebSocket) =>
	new Promise<any>((resolve) =>
		socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))),
	);
it("sends a fresh durable snapshot before accepting authenticated commands", async () => {
	const f = await fixture();
	const socket = await f.connect();
	const snapshot = next(socket);
	socket.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	expect(await snapshot).toMatchObject({
		type: "shared_snapshot",
		snapshot: { events: [{ id: 7 }] },
	});
	const receipt = next(socket);
	socket.send(
		JSON.stringify({
			type: "create_conversation",
			requestId: "r",
			title: "Design",
		}),
	);
	expect(await receipt).toMatchObject({
		type: "command_accepted",
		requestId: "r",
	});
	expect(f.command).toHaveBeenCalledTimes(1);
});
it("replacement tab takes control without invoking cancellation", async () => {
	const f = await fixture();
	const first = await f.connect();
	const a = next(first);
	first.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	await a;
	const second = await f.connect();
	const b = next(second);
	const closed = new Promise<number>((resolve) => first.once("close", resolve));
	second.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	await b;
	expect(await closed).toBe(4001);
	expect(f.command).not.toHaveBeenCalled();
});
it("rejects unauthenticated commands and serves the normal application root", async () => {
	const f = await fixture();
	const socket = await f.connect();
	const closed = new Promise<number>((resolve) =>
		socket.once("close", resolve),
	);
	socket.send(
		JSON.stringify({
			type: "create_conversation",
			requestId: "r",
			title: "Design",
		}),
	);
	expect(await closed).toBe(4003);
	expect(f.command).not.toHaveBeenCalled();
	expect(
		await (await fetch(`http://127.0.0.1:${f.port}/`)).text(),
	).toContain("Hopper");
});

it("keeps the host alive when an authenticated browser reconnects during initialization", async () => {
	let initializing = true;
	const f = await fixture(() => {
		if (initializing) throw new Error("Host is initializing");
		return { tasks: [], events: [] };
	});
	const early = await f.connect();
	const closed = new Promise<number>((resolve) => early.once("close", resolve));
	early.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	expect(await closed).toBe(1013);
	initializing = false;
	const retry = await f.connect();
	const snapshot = next(retry);
	retry.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	expect(await snapshot).toMatchObject({ type: "shared_snapshot" });
	expect(f.command).not.toHaveBeenCalled();
});


it("normal UI tools, skills and conversation export use the browser credential", async () => {
	const runtime = {
		listTools: vi.fn(() => ({ tools: [] })),
		listSkills: vi.fn(async () => ({ skills: [] })),
		updateSkills: vi.fn(async () => ({ skills: [] })),
	};
	const exportConversation = vi.fn((id) => ({ conversationId: id, tasks: [] }));
	const f = await fixture(undefined, { uiRuntime: () => runtime as any, exportConversation });
	for (const path of ["/api/tools", "/api/skills", "/api/session/export?conversationId=selected"]) {
		expect((await fetch(`http://127.0.0.1:${f.port}${path}`)).status).toBe(403);
		const response = await fetch(`http://127.0.0.1:${f.port}${path}`, { headers: { Authorization: "Bearer secret" } });
		expect(response.status).toBe(200);
	}
	expect(runtime.listTools).toHaveBeenCalledOnce();
	expect(runtime.listSkills).toHaveBeenCalledOnce();
	expect(exportConversation).toHaveBeenCalledWith("selected");
	const response = await fetch(`http://127.0.0.1:${f.port}/api/skills`, {
		method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
		body: JSON.stringify({ type: "toggle", id: "skill", enabled: false }),
	});
	expect(response.status).toBe(200);
	expect(runtime.updateSkills).toHaveBeenCalledWith({ type: "toggle", id: "skill", enabled: false });
});
