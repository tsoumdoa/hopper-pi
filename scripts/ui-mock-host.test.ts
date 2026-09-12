import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

let child: ChildProcess;
let origin: string;
beforeAll(async () => {
	child = spawn(process.execPath, ["scripts/ui-mock-host.mjs", "--no-vite", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
	origin = await new Promise<string>((resolve, reject) => {
		let output = "";
		child.on("error", reject);
		child.on("exit", code => reject(new Error(`Mock exited ${code}: ${output}`)));
		child.stderr!.on("data", chunk => { output += chunk; });
		child.stdout!.on("data", chunk => {
			output += chunk;
			const match = output.match(/host on (http:\/\/127\.0\.0\.1:\d+)/);
			if (match) resolve(match[1]);
		});
	});
}, 15_000);
afterAll(async () => {
	if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
});

const api = (path: string, body?: unknown, token = "mock-empty") => fetch(`${origin}${path}`, {
	headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
	...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
});
async function connect() {
	const ws = new WebSocket(origin.replace("http", "ws") + "/ws-shared");
	await once(ws, "open");
	const snapshot = once(ws, "message");
	ws.send(JSON.stringify({ type: "authenticate", token: "mock-empty" }));
	await snapshot;
	return ws;
}
async function command(ws: WebSocket, value: object) {
	const result = new Promise<any>(resolve => {
		const listener = (raw: WebSocket.RawData) => {
			const message = JSON.parse(raw.toString());
			if (message.type === "command_accepted" || message.type === "error") {
				ws.off("message", listener); resolve(message);
			}
		};
		ws.on("message", listener);
	});
	ws.send(JSON.stringify(value));
	return result;
}

test("tools settings support versioned changes and reject stale writes", async () => {
	const initial = await (await api("/api/tools")).json();
	const action = { type: "patch", expected: initial.settings.version, patch: { target: "parents", id: "hopper.rhino", enabled: false } };
	const response = await api("/api/tools?target=mock", action);
	expect(response.status).toBe(200);
	const changed = await response.json();
	expect(changed.snapshot.context.kind).toBe("target");
	expect(changed.snapshot.tools.find((tool: any) => tool.name === "rh_document").active).toBe(false);
	expect((await api("/api/tools", action)).status).toBe(409);
	expect((await api("/api/tools", { type: "garbage" })).status).toBe(400);
});

test("skill paths resolve and malformed requests do not crash the server", async () => {
	const library = await (await api("/api/skills")).json();
	for (const skill of library.skills) {
		expect(skill.files).toContain(skill.path);
		for (const file of skill.files) expect((await api(`/api/skills?file=${encodeURIComponent(file)}`)).status).toBe(200);
	}
	expect((await fetch(`${origin}/api/skills`, { method: "POST", headers: { Authorization: "Bearer mock-empty" }, body: "{" })).status).toBe(400);
	expect((await api("/api/skills", undefined, "invalid")).status).toBe(403);
	expect((await api("/api/tools")).status).toBe(200);
});

test("reconnects preserve conversations and request replay does not duplicate them", async () => {
	let ws = await connect();
	try {
		const create = { type: "create_conversation", requestId: "create-test", title: "Export test" };
		const first = await command(ws, create);
		expect(first.type).toBe("command_accepted");
		ws.close(); await once(ws, "close");
		ws = await connect();
		expect(await command(ws, create)).toEqual(first);
		const second = await command(ws, { ...create, requestId: "create-second", title: "Another" });
		expect(second.result.conversationId).not.toBe(first.result.conversationId);
		const exported = await (await api(`/api/session/export?conversationId=${first.result.conversationId}`)).json();
		expect(exported.format).toBe("hopper-conversation-debug");
		expect(exported.version).toBe(1);
		expect(exported.conversation.id).toBe(first.result.conversationId);
		expect(exported.sessions).toHaveLength(1);
		const invalid = once(ws, "message"); ws.send("{");
		expect(JSON.parse(String((await invalid)[0])).type).toBe("error");
		expect((await command(ws, { ...create, requestId: "still-alive" })).type).toBe("command_accepted");
	} finally { ws.close(); }
});

test("tabs share threads while keeping independent selected histories", async () => {
	const first = await connect();
	const second = await connect();
	try {
		const a = await command(first, { type: "create_conversation", requestId: "tab-a", title: "Tab A" });
		const b = await command(second, { type: "create_conversation", requestId: "tab-b", title: "Tab B" });
		const nextSnapshot = (ws: WebSocket) => new Promise<any>(resolve => {
			const listener = (raw: WebSocket.RawData) => {
				const message = JSON.parse(raw.toString());
				if (message.type === "shared_snapshot") { ws.off("message", listener); resolve(message.snapshot); }
			};
			ws.on("message", listener);
		});
		const one = nextSnapshot(first);
		const two = nextSnapshot(second);
		first.send(JSON.stringify({ type: "snapshot", conversationId: a.result.conversationId }));
		expect((await one).history.conversationId).toBe(a.result.conversationId);
		expect((await two).history.conversationId).toBe(b.result.conversationId);
	} finally { first.close(); second.close(); }
});
