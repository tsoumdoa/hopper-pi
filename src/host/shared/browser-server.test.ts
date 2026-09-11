import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { createSharedBrowserServer } from "./browser-server.js";
import { SharedBackend } from "./backend.js";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedTaskService } from "./task-service.js";
import type { HostRuntime } from "../pi-runtime.js";
import { applySnapshotPatch } from "./snapshot-patch.js";
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
it("sends row patches after the initial snapshot and starts a replacement connection with a full snapshot", async () => {
	let state = { eventCursor: 1, tasks: [], events: [{ id: 1, kind: "progress", payload: "capture".repeat(10000) }] };
	let publish: ((event: unknown) => void) | undefined;
	const backend = { snapshot: () => state, command: async () => null,
		subscribe: (listener: (event: unknown) => void) => { publish = listener; return () => { publish = undefined; }; } };
	// The fixture's backend can be replaced through its normal server options.
	const f = await fixture(() => state, { backend });
	const socket = await f.connect();
	const initial = next(socket);
	socket.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	const received = await initial;
	expect(received.type).toBe("shared_snapshot");
	state = { ...state, eventCursor: 2, events: [...state.events, { id: 2, kind: "progress", payload: "new text" }] };
	const update = next(socket);
	publish!({ type: "shared_snapshot", snapshot: state });
	const patch = await update;
	expect(patch.type).toBe("shared_patch");
	expect(JSON.stringify(patch)).not.toContain("capture");
	expect(applySnapshotPatch(received.snapshot, patch.patch)).toEqual(state);
	const replacement = await f.connect();
	const restored = next(replacement);
	replacement.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	expect(await restored).toEqual({ type: "shared_snapshot", snapshot: state });
});
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
		getToolSettings: vi.fn(async () => ({ tools: [] })),
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
	expect(runtime.getToolSettings).toHaveBeenCalledOnce();
	expect(runtime.listSkills).toHaveBeenCalledOnce();
	expect(exportConversation).toHaveBeenCalledWith("selected");
	const response = await fetch(`http://127.0.0.1:${f.port}/api/skills`, {
		method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
		body: JSON.stringify({ type: "toggle", id: "skill", enabled: false }),
	});
	expect(response.status).toBe(200);
	expect(runtime.updateSkills).toHaveBeenCalledWith({ type: "toggle", id: "skill", enabled: false });
});


it("builds streamed snapshots only while an authenticated browser is connected", async () => {
	const journal = new TaskJournal(":memory:");
	cleanup.push(() => journal.close());
	const registry = new SharedRegistry(journal);
	const tasks = new SharedTaskService(journal, {
		resolveBinding: (binding) => registry.resolveBinding(binding),
		validateBinding: () => {},
		createDriver: () => { throw new Error("No model needed"); },
	});
	const admin = { snapshot: () => ({}), bus: { subscribe: () => () => {} } } as unknown as HostRuntime;
	const backend = new SharedBackend(tasks, registry, admin, async () => {});
	cleanup.push(() => backend.dispose());
	const snapshot = vi.spyOn(backend, "snapshot");
	const subscribe = backend.subscribe.bind(backend);
	let onUnsubscribe: (() => void) | undefined;
	vi.spyOn(backend, "subscribe").mockImplementation((listener) => {
		const unsubscribe = subscribe(listener);
		return () => { unsubscribe(); onUnsubscribe?.(); };
	});
	const f = await fixture(undefined, { backend });
	const publish = () => {
		vi.useFakeTimers();
		try { backend.publish(); vi.advanceTimersByTime(50); }
		finally { vi.useRealTimers(); }
	};
	publish();
	expect(snapshot).not.toHaveBeenCalled();
	const first = await f.connect();
	publish();
	expect(snapshot).not.toHaveBeenCalled();
	const initial = next(first);
	first.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	await initial;
	snapshot.mockClear();
	const update = next(first);
	publish();
	await update;
	expect(snapshot).toHaveBeenCalledOnce();

	// Closing the replaced tab must not unsubscribe the new controller.
	const second = await f.connect();
	const replacement = next(second);
	const replaced = new Promise<void>((resolve) => first.once("close", () => resolve()));
	second.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	await replacement;
	await replaced;
	snapshot.mockClear();
	const latest = next(second);
	publish();
	await latest;
	expect(snapshot).toHaveBeenCalledOnce();
	const disconnected = new Promise<void>((resolve) => { onUnsubscribe = resolve; });
	second.close();
	await disconnected;
	snapshot.mockClear();
	publish();
	expect(snapshot).not.toHaveBeenCalled();
});

it("routes tool context only after authenticating the browser request", async () => {
	const runtime = { getToolSettings: vi.fn(async () => ({ tools: [] })) };
	const target = { getToolSettings: vi.fn(async () => ({ tools: [], context: { kind: "target" as const, label: "Selected target" } })), updateToolSettings: vi.fn(async () => ({ ok: true, snapshot: { tools: [] } })) };
	const tools = vi.fn((_query: URLSearchParams) => target);
	const f = await fixture(undefined, { uiRuntime: () => runtime as any, tools });
	const url = `http://127.0.0.1:${f.port}/api/tools?conversationId=second&taskId=running`;
	expect((await fetch(url)).status).toBe(403);
	expect(tools).not.toHaveBeenCalled();
	expect(await (await fetch(url, { headers: { Authorization: "Bearer secret" } })).json()).toMatchObject({ context: { kind: "target" } });
	expect(tools.mock.calls[0]?.[0]?.get("conversationId")).toBe("second");
	expect(runtime.getToolSettings).not.toHaveBeenCalled();
	await fetch(url, { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify({ type: "check-connection" }) });
	expect(target.updateToolSettings).toHaveBeenCalledWith({ type: "check-connection" });
});

it("publishes archive, restore and delete changes even without a new task event", async () => {
	const journal = new TaskJournal(":memory:");
	cleanup.push(() => journal.close());
	const registry = new SharedRegistry(journal);
	const tasks = new SharedTaskService(journal, {
		resolveBinding: (binding) => registry.resolveBinding(binding),
		validateBinding: () => {},
		createDriver: () => {
			throw new Error("No model needed");
		},
	});
	const admin = {
		snapshot: () => ({}),
		bus: { subscribe: () => () => {} },
	} as unknown as HostRuntime;
	const backend = new SharedBackend(tasks, registry, admin, async () => {});
	cleanup.push(() => backend.dispose());
	const chat = journal.createConversation("create", "New chat");
	const f = await fixture(undefined, { backend });
	const socket = await f.connect();
	let response = next(socket);
	socket.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	let state = (await response).snapshot;
	expect(state.conversations).toHaveLength(1);
	for (const type of [
		"archive_conversation",
		"unarchive_conversation",
		"delete_conversation",
	]) {
		const frames: any[] = [];
		const collect = (raw: unknown) => frames.push(JSON.parse(String(raw)));
		socket.on("message", collect);
		socket.send(
			JSON.stringify({
				type,
				requestId: type,
				conversationId: chat.conversationId,
			}),
		);
		await expect
			.poll(() => frames.some((frame) => frame.type === "command_accepted"))
			.toBe(true);
		await expect
			.poll(() =>
				frames.some(
					(frame) =>
						frame.type === "shared_patch" || frame.type === "shared_snapshot",
				),
			)
			.toBe(true);
		const update = frames.find(
			(frame) =>
				frame.type === "shared_patch" || frame.type === "shared_snapshot",
		);
		state =
			update.type === "shared_patch"
				? applySnapshotPatch(state, update.patch)
				: update.snapshot;
		if (type === "delete_conversation") expect(state.conversations).toEqual([]);
		else
			expect(Boolean(state.conversations[0].archived_at)).toBe(
				type === "archive_conversation",
			);
		socket.off("message", collect);
	}
});
