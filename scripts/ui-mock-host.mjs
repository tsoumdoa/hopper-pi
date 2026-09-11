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
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

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

const facade = { kind: "rhino", lifecycleInstanceId: "life-1", rhinoDocumentId: "doc-facade" };
const roof = { kind: "rhino", lifecycleInstanceId: "life-2", rhinoDocumentId: "doc-roof" };
const untitled = { kind: "rhino", lifecycleInstanceId: "life-2", rhinoDocumentId: "doc-untitled" };
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const progressEvent = (taskId, turnId, payload) => ({ task_id: taskId, kind: "progress", payload: JSON.stringify({ turnId, ...payload }) });
const messagesEvent = (taskId, turnId, messages) => progressEvent(taskId, turnId, { type: "messages", messages });
const toolProgress = (taskId, turnId, toolName, toolCallId, phase, isError = false) => progressEvent(taskId, turnId, { type: "tool_progress", toolName, toolCallId, phase, isError });
const agentEvent = (taskId, turnId, event) => progressEvent(taskId, turnId, { type: "agent_event", event });

function baseSnapshot() {
	return {
		hostEpoch: "mock-epoch",
		conversations: [],
		sessions: [],
		tasks: [],
		turns: [],
		events: [],
		records: [],
		recoveries: [],
		questions: [],
		inputs: [],
		targets: [
			{ label: "Rhino", lifecycleInstanceId: "life-1", processId: 4021, admission: "ready", documents: [facade], documentLabels: { "doc-facade": "Facade.3dm" } },
			{ label: "Rhino", lifecycleInstanceId: "life-2", processId: 4188, admission: "ready", documents: [roof, untitled], documentLabels: { "doc-roof": "Roof.3dm" } },
		],
		installations: [{ id: "rhino", platform: process.platform, build: "8", bootstrapVerified: true }],
		runtime: {
			sessionId: "mock-session",
			sessionName: "Mock session",
			messages: [],
			isStreaming: false,
			thinkingLevel: "medium",
			availableThinkingLevels: ["off", "low", "medium", "high"],
			model: { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", input: ["text", "image"] },
			models: [
				{ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", input: ["text", "image"] },
				{ provider: "anthropic", id: "claude-opus-4", name: "Claude Opus 4", input: ["text", "image"] },
				{ provider: "openai", id: "gpt-5", name: "GPT-5", input: ["text", "image"] },
			],
			providers: [
				{ id: "anthropic", name: "Anthropic", authenticated: true, authTypes: ["api_key", "oauth"] },
				{ id: "openai", name: "OpenAI", authenticated: false, authTypes: ["api_key"] },
			],
			pendingUiRequests: [],
		},
		eventCursor: 0,
	};
}

/** Populates a conversation with fixture tasks for the given scenario. */
function seedScenario(snapshot, scenario, conversationId) {
	const now = Date.now();
	const task = (id, state, payload, extra = {}) => ({ id, conversation_id: conversationId, parent_task_id: null, state, session_id: `${conversationId}-session`, created_at: now - 600_000, updated_at: now - 540_000, payload: JSON.stringify(payload), ...extra });
	if (scenario === "empty") return;

	snapshot.tasks.push(task("t1", "completed", { kind: "prompt", text: "Check the facade model and tell me what geometry is present.", bindings: [facade] }));
	snapshot.turns.push({ id: "turn-1", task_id: "t1", state: "completed", started_at: now - 600_000, ended_at: now - 540_000 });
	snapshot.events.push(
		messagesEvent("t1", "turn-1", [
			{ role: "assistant", content: [{ type: "thinking", thinking: "The user wants an inventory of the active Rhino document. Query objects grouped by layer first." }, { type: "toolCall", id: "call-1", name: "rh_query_objects", arguments: { groupBy: "layer" } }] },
			{ role: "toolResult", toolCallId: "call-1", toolName: "rh_query_objects", content: [{ type: "text", text: "Walls: 12 polysurfaces\nGlazing: 48 surfaces\nMullions: 96 curves" }], isError: false },
			{ role: "toolResult", toolCallId: "call-2", toolName: "rh_capture_view", content: [{ type: "image", mimeType: "image/png", data: PNG_1PX }], isError: false },
			{ role: "assistant", content: [{ type: "text", text: "The **Facade.3dm** document has three populated layers:\n\n- `Walls`: 12 closed polysurfaces\n- `Glazing`: 48 planar surfaces\n- `Mullions`: 96 curves\n\nNothing is on the default layer, and there are no blocks." }] },
		]),
		toolProgress("t1", "turn-1", "rh_query_objects", "call-1", "completed"),
	);

	snapshot.tasks.push(task("t2", "completed", { kind: "follow_up", text: "Add a 600mm parapet along the top of every wall.", bindings: [facade] }, { created_at: now - 500_000, updated_at: now - 420_000 }));
	snapshot.turns.push({ id: "turn-2", task_id: "t2", state: "completed", started_at: now - 500_000, ended_at: now - 420_000 });
	snapshot.questions.push({ id: "q1", task_id: "t2", answer: JSON.stringify("Meters"), payload: JSON.stringify({ question: "Which units does this document use?", options: ["Millimeters", "Meters"] }) });
	snapshot.inputs.push({ id: 1, task_id: "t2", turn_id: "turn-2", state: "applied", payload: JSON.stringify({ text: "Keep the parapet on the Walls layer." }) });
	snapshot.inputs.push({ id: 2, task_id: "t2", turn_id: "turn-2", state: "not_applied", payload: JSON.stringify({ text: "Actually make it 900mm." }) });
	snapshot.events.push(messagesEvent("t2", "turn-2", [{ role: "assistant", content: [{ type: "text", text: "Added 12 parapet extrusions (0.6 m tall) on the `Walls` layer. The document is in meters, so I converted the height." }] }]));

	if (scenario === "running") {
		snapshot.tasks.push(task("t3", "running", { kind: "prompt", text: "Compare the facade against the roof model and flag any clashes.", bindings: [facade, roof] }, { created_at: now - 40_000, updated_at: now - 40_000 }));
		snapshot.turns.push({ id: "turn-3", task_id: "t3", state: "running", started_at: now - 38_000, owner: JSON.stringify({ binding: facade }) });
		snapshot.events.push(
			agentEvent("t3", "turn-3", { type: "message_start", message: { role: "assistant" } }),
			agentEvent("t3", "turn-3", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Two documents are involved, so inspect each in its own Rhino instance and then intersect bounding boxes." } }),
			agentEvent("t3", "turn-3", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I'm inspecting both models now. The facade is loaded; waiting on the roof" } }),
		);
		snapshot.tasks.push({ ...task("t3-child", "running", { kind: "prompt", text: "Inspect the roof model for the clash check.", bindings: [roof] }, { created_at: now - 30_000, updated_at: now - 30_000 }), parent_task_id: "t3", root_task_id: "t3", session_id: "worker-1" });
		snapshot.turns.push({ id: "turn-3c", task_id: "t3-child", state: "running", started_at: now - 29_000 });
		snapshot.events.push(
			messagesEvent("t3-child", "turn-3c", [{ role: "assistant", content: [{ type: "toolCall", id: "call-3", name: "rh_query_objects", arguments: { layer: "Roof" } }] }]),
			toolProgress("t3-child", "turn-3c", "rh_query_objects", "call-3", "started"),
		);
		snapshot.tasks.push(task("t4", "queued", { kind: "follow_up", text: "Then export a clash report as CSV.", bindings: [facade] }, { created_at: now - 10_000, updated_at: now - 10_000 }));
	}
	if (scenario === "question") {
		snapshot.tasks.push(task("t3", "awaiting_user", { kind: "prompt", text: "Rebuild the mullions as a parametric grid.", bindings: [roof] }, { created_at: now - 40_000, updated_at: now - 20_000 }));
		snapshot.turns.push({ id: "turn-3", task_id: "t3", state: "running", started_at: now - 38_000 });
		snapshot.questions.push({ id: "q2", task_id: "t3", answer: null, payload: JSON.stringify({ question: "Which spacing should the mullion grid use?", options: ["1.2 m", "1.5 m", "Match existing"] }) });
	}
	if (scenario === "failed") {
		snapshot.tasks.push(task("t3", "failed", { kind: "prompt", text: "Launch a second Rhino for the roof.", bindings: [] }, { created_at: now - 40_000, updated_at: now - 20_000 }));
		snapshot.records.push({ kind: "launch", id: "launch-1", task_id: "t3", state: "uncertain", payload: JSON.stringify({ dispatchAttempted: true, request: { installationId: "rhino", independentProcess: false }, detail: "Registration outcome unknown." }) });
		snapshot.tasks.push(task("t5", "uncertain", { kind: "prompt", text: "Delete the temporary construction layer.", bindings: [facade] }, { created_at: now - 15_000, updated_at: now - 10_000 }));
		snapshot.turns.push({ id: "turn-5", task_id: "t5", state: "uncertain", started_at: now - 15_000 });
	}
}

/** One connected browser: owns a snapshot, applies commands, and simulates task progress. */
class MockBackend {
	constructor(scenario, send) {
		this.scenario = scenario;
		this.send = send;
		this.snapshot = baseSnapshot();
		this.timers = new Set();
	}
	publish() {
		this.snapshot.eventCursor++;
		this.send({ type: "shared_snapshot", snapshot: this.snapshot });
	}
	later(ms, fn, publish = true) {
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			fn();
			if (publish) this.publish();
		}, ms);
		this.timers.add(timer);
	}
	dispose() {
		for (const timer of this.timers) clearTimeout(timer);
	}
	task(id) {
		return this.snapshot.tasks.find((task) => task.id === id);
	}
	finish(task, state) {
		task.state = state;
		task.updated_at = Date.now();
		for (const turn of this.snapshot.turns) if (turn.task_id === task.id && turn.state === "running") {
			turn.state = state;
			turn.ended_at = Date.now();
		}
	}
	command(command) {
		const { snapshot } = this;
		switch (command.type) {
			case "snapshot":
				this.publish();
				return null;
			case "create_conversation": {
				const id = `conversation-${snapshot.conversations.length + 1}`;
				snapshot.conversations.push({ id, title: snapshot.conversations.length ? command.title : "Facade study" });
				snapshot.sessions.push({ id: `${id}-session`, conversation_id: id });
				if (snapshot.conversations.length === 1) seedScenario(snapshot, this.scenario, id);
				this.publish();
				return { conversationId: id };
			}
			case "submit":
				return this.submit(command);
			case "steer": {
				snapshot.inputs.push({ id: snapshot.inputs.length + 1, task_id: command.taskId, turn_id: command.turnId, state: "applied", payload: JSON.stringify({ text: command.text, attachments: command.attachments }) });
				this.publish();
				return { inputId: snapshot.inputs.length };
			}
			case "answer": {
				const question = snapshot.questions.find((question) => question.id === command.questionId);
				if (!question || question.answer !== null) throw new Error("Question is no longer pending");
				question.answer = JSON.stringify(command.answer);
				const task = this.task(question.task_id);
				if (task) {
					task.state = "running";
					this.later(1_500, () => {
						snapshot.events.push(messagesEvent(task.id, `turn-${task.id}`, [{ role: "assistant", content: [{ type: "text", text: `Using **${command.answer}**. Rebuilt the mullion grid on the roof model.` }] }]));
						this.finish(task, "completed");
					});
				}
				this.publish();
				return null;
			}
			case "cancel": {
				const task = this.task(command.taskId);
				if (!task) throw new Error("Unknown task");
				this.finish(task, "cancelled");
				this.publish();
				return null;
			}
			case "recover":
				snapshot.recoveries.push({ task_id: command.taskId, acknowledgement: command.acknowledgement });
				this.publish();
				return null;
			case "recover_launch":
				snapshot.records.push({ kind: "launch_recovery", id: command.launchRequestId, task_id: command.taskId, state: "confirmed", payload: "{}" });
				this.publish();
				return null;
			case "set_model": {
				const model = snapshot.runtime.models.find((model) => model.provider === command.provider && model.id === command.modelId);
				if (!model) throw new Error("Unknown model");
				snapshot.runtime.model = model;
				this.publish();
				return null;
			}
			case "set_thinking":
				snapshot.runtime.thinkingLevel = command.level;
				this.publish();
				return null;
			case "login": {
				const provider = snapshot.runtime.providers.find((provider) => provider.id === command.provider);
				if (!provider) throw new Error("Unknown provider");
				this.later(600, () => {
					provider.authenticated = true;
					this.send({ type: "auth_event", event: { type: "success", provider: provider.id, message: `${provider.name} connected.` } });
				});
				return null;
			}
			case "logout": {
				const provider = snapshot.runtime.providers.find((provider) => provider.id === command.provider);
				if (provider) provider.authenticated = false;
				this.publish();
				return null;
			}
			case "auth_response":
				return null;
			case "stop_host":
				throw new Error("The mock host does not stop. Close the terminal instead.");
			default:
				throw new Error(`Unsupported mock command: ${command.type}`);
		}
	}
	submit(command) {
		const { snapshot } = this;
		const id = `task-${randomUUID().slice(0, 8)}`;
		const turnId = `turn-${id}`;
		const now = Date.now();
		snapshot.tasks.push({ id, conversation_id: command.conversationId, parent_task_id: null, state: "queued", session_id: command.sessionId, created_at: now, updated_at: now, payload: JSON.stringify({ kind: command.kind, text: command.text, bindings: command.bindings, attachments: command.attachments }) });
		snapshot.turns.push({ id: turnId, task_id: id, state: "queued" });
		const task = this.task(id);
		const turn = snapshot.turns.find((turn) => turn.id === turnId);
		const busy = snapshot.tasks.some((other) => other.id !== id && other.parent_task_id === null && other.conversation_id === command.conversationId && ["running", "suspending", "awaiting_user"].includes(other.state));
		const start = () => {
			task.state = "running";
			turn.state = "running";
			turn.started_at = Date.now();
			turn.owner = JSON.stringify({ binding: command.bindings[0] });
			snapshot.events.push(agentEvent(id, turnId, { type: "message_start", message: { role: "assistant" } }));
			const words = `Working on "${command.text.trim()}" in ${command.bindings.length} Rhino document${command.bindings.length === 1 ? "" : "s"}. This is a mock answer, so nothing changed in Rhino, but the layout you see here matches a real streaming reply.`.split(" ");
			words.forEach((word, index) => this.later(400 + index * 90, () => {
				snapshot.events.push(agentEvent(id, turnId, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${index ? " " : ""}${word}` } }));
			}));
			this.later(400 + words.length * 90 + 800, () => {
				snapshot.events.push(messagesEvent(id, turnId, [{ role: "assistant", content: [{ type: "text", text: words.join(" ") }] }]));
				this.finish(task, "completed");
			});
		};
		if (busy) {
			// Queued follow-ups start once the active task settles; poll rather than model the scheduler.
			const poll = () => {
				const stillBusy = snapshot.tasks.some((other) => other.id !== id && other.parent_task_id === null && other.conversation_id === command.conversationId && ["running", "suspending", "awaiting_user"].includes(other.state));
				if (stillBusy) this.later(1_000, poll, false);
				else this.later(0, start);
			};
			this.later(1_000, poll, false);
		} else {
			this.later(500, start);
		}
		this.publish();
		return { taskId: id };
	}
}

function json(response, status, body) {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	response.end(JSON.stringify(body, null, 2));
}

let latest = null;
const skills = { folder: "~/.hopper/skills (mock)", diagnostics: [], skills: [
	{ id: "pavilion", name: "Parametric pavilion", description: "Grasshopper recipe for a simple pavilion shell.", path: "pavilion/SKILL.md", source: "bundled", enabled: true, manualOnly: false, files: ["SKILL.md"] },
	{ id: "clash", name: "Clash report", description: "Compare two Rhino documents and list intersecting objects.", path: "clash/SKILL.md", source: "user", enabled: false, manualOnly: true, files: ["SKILL.md", "report.csv.tmpl"] },
] };
const tools = { tools: [
	{ name: "rh_query_objects", description: "List Rhino objects, optionally filtered by layer.", parameters: { type: "object", properties: { layer: { type: "string" } } }, active: true },
	{ name: "rh_capture_view", description: "Capture the active Rhino viewport as an image.", parameters: { type: "object", properties: {} }, active: true },
	{ name: "gh_apply_graph", description: "Apply a Grasshopper graph to the active canvas.", parameters: { type: "object", properties: { graph: { type: "object" } } }, active: false },
] };

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/health" || url.pathname === "/api/shared/health") return json(response, 200, { mode: "mock", ok: true });
	if (url.pathname === "/api/session/export") return json(response, 200, latest?.snapshot ?? { error: "No browser connected" });
	if (url.pathname === "/api/tools") return json(response, 200, tools);
	if (url.pathname === "/api/skills") {
		if (request.method === "POST") {
			let body = "";
			request.on("data", (chunk) => { body += chunk; });
			request.on("end", () => {
				const update = JSON.parse(body || "{}");
				if (update.type === "toggle") for (const skill of skills.skills) if (skill.id === update.id) skill.enabled = update.enabled;
				if (update.type === "folder") skills.folder = update.folder;
				json(response, 200, skills);
			});
			return;
		}
		const file = url.searchParams.get("file");
		if (file) return json(response, 200, { content: `# ${file}\n\nMock skill content for ${file}.\n` });
		return json(response, 200, skills);
	}
	json(response, 404, { error: "Not found. The mock host only serves /ws-shared and the UI's /api routes; run Vite for the page." });
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
	let backend = null;
	const send = (message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); };
	ws.on("close", () => backend?.dispose());
	ws.on("message", (raw) => {
		const command = JSON.parse(raw.toString());
		if (!backend) {
			if (command.type !== "authenticate" || typeof command.token !== "string" || !command.token.startsWith("mock")) {
				ws.close(4003, "Authentication failed");
				return;
			}
			const scenario = command.token.replace(/^mock-?/, "") || "running";
			if (!SCENARIOS.includes(scenario)) {
				ws.close(4003, `Unknown mock scenario "${scenario}". Use one of: ${SCENARIOS.join(", ")}`);
				return;
			}
			backend = latest = new MockBackend(scenario, send);
			console.log(`[mock] browser connected with the "${scenario}" fixture`);
			backend.publish();
			return;
		}
		const requestId = command.requestId;
		try {
			const result = backend.command(command);
			if (requestId) send({ type: "command_accepted", requestId, result });
		} catch (error) {
			send({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
		}
	});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock] host on http://127.0.0.1:${PORT} (fixtures: ${SCENARIOS.map((name) => `#mock-${name}`).join(", ")})`);
	if (!START_VITE) return;
	const vite = spawn("pnpm", ["exec", "vite", "--port", String(UI_PORT), "--strictPort", "--open", "/#mock-running"], {
		stdio: "inherit",
		env: { ...process.env, HOPPER_UI_PROXY_TARGET: `http://127.0.0.1:${PORT}` },
	});
	vite.on("exit", (code) => {
		server.close();
		process.exit(code ?? 0);
	});
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => vite.kill(signal));
});
