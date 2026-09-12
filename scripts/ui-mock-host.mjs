#!/usr/bin/env node
// Fake shared Hopper host for browser UI development. No Rhino, no model provider, no SQLite.
//
//   node scripts/ui-mock-host.mjs    start the mock host and Vite on http://localhost:5174/#mock-running
//   node scripts/ui-mock-host.mjs --no-vite --port 19788
//
// The URL fragment picks the fixture: #mock-running, #mock-question, #mock-failed, #mock-empty.
// Sending a message queues a task that streams a canned answer and completes a few seconds later.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MockBackend } from "./ui-mock-backend.mjs";
import { tsImport } from "tsx/esm/api";

const { parseSharedBrowserCommand } = await tsImport("../src/host/shared/browser-protocol.ts", import.meta.url);
const { parseToolSettingsAction, parseSkillLibraryUpdate } = await tsImport("../src/host/protocol.ts", import.meta.url);
const { createMockToolSettings } = await tsImport("../web/src/mocks/tool-settings-mock.ts", import.meta.url);
const toolSettings = createMockToolSettings();

const { WebSocketServer } = createRequire(import.meta.url)("ws");

const args = process.argv.slice(2);
const flag = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const PORT = Number(flag("--port") ?? process.env.HOPPER_MOCK_PORT ?? 19788);
const UI_PORT = Number(flag("--ui-port") ?? 5174);
const START_VITE = !args.includes("--no-vite");
const SCENARIOS = ["running", "question", "failed", "empty"];

function json(response, status, body) {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	response.end(JSON.stringify(body, null, 2));
}

const backends = new Map();
const skills = { folder: "~/.hopper/skills (mock)", diagnostics: [], skills: [
	{ id: "pavilion", name: "Parametric pavilion", description: "Grasshopper recipe for a simple pavilion shell.", path: "pavilion/SKILL.md", source: "bundled", enabled: true, manualOnly: false, files: ["pavilion/SKILL.md"] },
	{ id: "clash", name: "Clash report", description: "Compare two Rhino documents and list intersecting objects.", path: "clash/SKILL.md", source: "user", enabled: false, manualOnly: true, files: ["clash/SKILL.md", "clash/report.md"] },
] };
function backendForToken(token) {
	if (token !== "mock" && !token.startsWith("mock-")) return null;
	const scenario = token === "mock" ? "running" : token.replace(/^mock-/, "");
	if (!SCENARIOS.includes(scenario)) return null;
	if (!backends.has(scenario)) {
		const clients = new Set();
		const backend = new MockBackend(scenario, (message) => {
			for (const send of clients) send(message);
		});
		backends.set(scenario, { backend, clients, receipts: new Map() });
	}
	return backends.get(scenario);
}

async function readBody(request) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		bytes += chunk.length;
		if (bytes > 16_384) throw new Error("Setting is too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/health" || url.pathname === "/api/shared/health") return json(response, 200, { mode: "mock", ok: true });
	if (!["/api/session/export", "/api/tools", "/api/skills"].includes(url.pathname)) return json(response, 404, { error: "Not found" });
	const authorization = request.headers.authorization ?? "";
	const state = authorization.startsWith("Bearer ") ? backendForToken(authorization.slice(7)) : null;
	if (!state) return json(response, 403, { error: "Forbidden" });
	if (!["GET", "POST"].includes(request.method) || (url.pathname === "/api/session/export" && request.method !== "GET")) return json(response, 405, { error: "Method not allowed" });
	try {
		if (url.pathname === "/api/session/export") {
			const snapshot = state.backend.snapshot;
			const conversationId = url.searchParams.get("conversationId");
			const conversation = snapshot.conversations.find(row => row.id === conversationId);
			if (!conversation) return json(response, 500, { error: "Could not export the current session" });
			const tasks = snapshot.tasks.filter(row => row.conversation_id === conversationId);
			const ids = new Set(tasks.map(row => row.id));
			const exported = { format: "hopper-conversation-debug", version: 1, exportedAt: new Date().toISOString(), conversation, tasks,
				sessions: snapshot.sessions.filter(row => row.conversation_id === conversationId) };
			for (const key of ["turns", "inputs", "questions", "events", "operations", "recoveries", "records", "dependencies"]) exported[key] = (snapshot[key] ?? []).filter(row => ids.has(row.task_id));
			response.setHeader("Content-Disposition", 'attachment; filename="hopper-session-debug.json"');
			return json(response, 200, exported);
		}
		if (url.pathname === "/api/tools") {
			const result = toolSettings(request.method === "POST" ? parseToolSettingsAction(await readBody(request)) : undefined);
			const snapshot = "snapshot" in result ? result.snapshot : result;
			const taskId = url.searchParams.get("taskId");
			if (taskId) snapshot.context = { kind: "task", taskId, label: "Mock task tools" };
			else if (url.searchParams.has("target")) snapshot.context = { kind: "target", label: "Mock document tools" };
			if ("ok" in result && result.ok) {
				for (const entry of backends.values()) for (const send of entry.clients) send({ type: "tool_settings", snapshot: toolSettings() });
			}
			return json(response, "ok" in result && !result.ok ? result.code === "conflict" ? 409 : 400 : 200, result);
		}
		if (request.method === "POST") {
			const update = parseSkillLibraryUpdate(await readBody(request));
			if (update.type === "toggle") {
				const skill = skills.skills.find(skill => skill.id === update.id);
				if (!skill) throw new Error("Unknown skill");
				skill.enabled = update.enabled;
			} else skills.folder = update.folder;
		}
		const file = url.searchParams.get("file");
		if (file && request.method === "GET") {
			if (!skills.skills.some(skill => skill.files.includes(file))) throw new Error("Unknown skill file");
			return json(response, 200, { content: `# ${file}\n\nMock skill content for ${file}.\n` });
		}
		return json(response, 200, skills);
	} catch (error) {
		return json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
	}
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
	if (request.url !== "/ws-shared") {
		socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
		socket.destroy();
		return;
	}
	sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
});
sockets.on("connection", (ws) => {
	let state = null;
	let view = {};
	const send = (message) => {
		if (ws.readyState !== ws.OPEN) return;
		const outgoing = message.type === "shared_snapshot" && state
			? { ...message, snapshot: state.backend.browserSnapshot(view) } : message;
		ws.send(JSON.stringify(outgoing));
	};
	ws.on("close", () => state?.clients.delete(send));
	ws.on("message", (raw) => {
		let command;
		try {
			command = parseSharedBrowserCommand(raw.toString());
			if (!state) {
				state = command.type === "authenticate" ? backendForToken(command.token) : null;
				if (!state) return ws.close(4003, "Authentication failed");
				state.clients.add(send);
				state.backend.publish();
				return;
			}
			const requestId = command.requestId;
			const previous = requestId && state.receipts.get(requestId);
			if (previous) {
				if (previous.command !== JSON.stringify(command)) throw new Error("Request ID was already used for another command");
				send(previous.response);
				return;
			}
			if (command.type === "snapshot") view = { conversationId: command.conversationId, before: command.before };
			const result = state.backend.command(command);
			if (command.type === "create_conversation") {
				view = { conversationId: result.conversationId };
				send({ type: "shared_snapshot" });
			}
			if (requestId) {
				const response = { type: "command_accepted", requestId, result };
				state.receipts.set(requestId, { command: JSON.stringify(command), response });
				send(response);
			}
		} catch (error) {
			send({ type: "error", requestId: command?.requestId, message: error instanceof Error ? error.message : String(error) });
		}
	});
});

server.listen(PORT, "127.0.0.1", () => {
	const port = server.address().port;
	console.log(`[mock] host on http://127.0.0.1:${port} (fixtures: ${SCENARIOS.map((name) => `#mock-${name}`).join(", ")})`);
	if (!START_VITE) return;
	const vite = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "--port", String(UI_PORT), "--strictPort", "--open", "/#mock-running"], {
		stdio: "inherit",
		env: { ...process.env, HOPPER_UI_PROXY_TARGET: `http://127.0.0.1:${port}` },
	});
	vite.on("error", (error) => {
		console.error(error.message);
		process.exit(1);
	});
	vite.on("exit", (code) => {
		server.close();
		process.exit(code ?? 0);
	});
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => vite.kill(signal));
});
