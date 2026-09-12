import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const facade = { kind: "rhino", lifecycleInstanceId: "life-1", rhinoDocumentId: "doc-facade" };
const roof = { kind: "rhino", lifecycleInstanceId: "life-2", rhinoDocumentId: "doc-roof" };
const untitled = { kind: "rhino", lifecycleInstanceId: "life-2", rhinoDocumentId: "doc-untitled" };
const CAPTURE_IMAGES = ["facade", "roof", "detail", "plan"].map((name) => ({
	type: "image", mimeType: "image/png",
	data: readFileSync(new URL(`./fixtures/chat-images/${name}.png`, import.meta.url)).toString("base64"),
}));

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
				{ id: "anthropic", name: "Anthropic", authenticated: true, authMethods: [{ type: "api_key", label: "API key" }, { type: "oauth", label: "Sign in" }] },
				{ id: "openai", name: "OpenAI", authenticated: false, authMethods: [{ type: "api_key", label: "API key" }] },
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

	snapshot.tasks.push(task("t1", "completed", { kind: "prompt", text: "Check the facade model and tell me what geometry is present.", bindings: [facade], attachments: scenario === "images" ? CAPTURE_IMAGES.slice(0, 3) : undefined }));
	snapshot.turns.push({ id: "turn-1", task_id: "t1", state: "completed", started_at: now - 600_000, ended_at: now - 540_000 });
	snapshot.events.push(
		messagesEvent("t1", "turn-1", [
			{ role: "assistant", content: [{ type: "thinking", thinking: "The user wants an inventory of the active Rhino document. Query objects grouped by layer first." }, { type: "toolCall", id: "call-1", name: "rh_query_objects", arguments: { groupBy: "layer" } }] },
			{ role: "toolResult", toolCallId: "call-1", toolName: "rh_query_objects", content: [{ type: "text", text: "Walls: 12 polysurfaces\nGlazing: 48 surfaces\nMullions: 96 curves" }], isError: false },
			{ role: "toolResult", toolCallId: "call-2", toolName: "rh_capture_view", content: CAPTURE_IMAGES, isError: false },
			{ role: "assistant", content: [{ type: "text", text: "The **Facade.3dm** document has three populated layers:\n\n- `Walls`: 12 closed polysurfaces\n- `Glazing`: 48 planar surfaces\n- `Mullions`: 96 curves\n\nNothing is on the default layer, and there are no blocks." }] },
		]),
		toolProgress("t1", "turn-1", "rh_query_objects", "call-1", "completed"),
	);

	// Exercise collapsed tool history in the default dev fixture too.
	if (scenario === "images" || scenario === "running") {
		const calls = ["rh_get_document_info", "rh_get_layers", "rh_query_objects", "rh_get_bounding_box", "rh_capture_view", "rh_capture_detail"];
		snapshot.events.push(...calls.map((name, index) => toolProgress("t1", "turn-1", name, `history-demo-${index}`, "completed")));
	}
	if (scenario === "images") return;

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
export class MockBackend {
	constructor(scenario, send) {
		this.scenario = scenario;
		this.send = send;
		this.snapshot = baseSnapshot();
		this.timers = new Set();
		this.view = {};
		this.nextConversation = 1;
		this.nextTaskSequence = 1;
		this.nextEventId = 1;
	}
	publish() {
		this.snapshot.eventCursor++;
		this.send({ type: "shared_snapshot", snapshot: this.browserSnapshot() });
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
	isLive(task) {
		return ["queued", "running", "suspending", "awaiting_user"].includes(task.state);
	}
	taskInConversation(id, conversationId) {
		const task = this.task(id);
		if (!task || task.conversation_id !== conversationId) throw new Error("Task is not in this conversation");
		return task;
	}
	deleteConversation(id) {
		const ids = new Set(this.snapshot.tasks.filter(task => task.conversation_id === id).map(task => task.id));
		for (const task of this.snapshot.tasks) if (ids.has(task.id)) this.finish(task, "cancelled");
		for (const key of ["conversations", "sessions", "tasks"]) this.snapshot[key] = this.snapshot[key].filter(row => key === "conversations" ? row.id !== id : row.conversation_id !== id);
		for (const key of ["turns", "events", "records", "recoveries", "questions", "inputs"]) this.snapshot[key] = this.snapshot[key].filter(row => !ids.has(row.task_id));
	}
	browserSnapshot(view = this.view) {
		const snapshot = this.snapshot;
		for (const task of snapshot.tasks) task.sequence ??= this.nextTaskSequence++;
		const conversations = snapshot.conversations.map(row => {
			const tasks = snapshot.tasks.filter(task => task.conversation_id === row.id && !task.parent_task_id);
			const payload = task => task ? JSON.parse(task.payload) : {};
			const target = task => payload(task).messageTarget ?? payload(task).bindings?.[0] ?? null;
			const recovery = snapshot.tasks.filter(task => task.conversation_id === row.id && task.state === "uncertain" && !snapshot.recoveries.some(record => record.task_id === task.id));
			const live = tasks.find(task => this.isLive(task) && task.state !== "queued") ?? tasks.find(task => task.state === "queued");
			return { ...row, last_activity_at: Math.max(row.created_at, ...tasks.map(task => task.updated_at)), live_state: live?.state ?? null, document_target: JSON.stringify(target(tasks[0])), last_message_target: JSON.stringify(target(tasks.at(-1))), document_label: null, recovery_required: Number(recovery.length > 0), instance_ids: JSON.stringify([...new Set(tasks.map(task => target(task)?.lifecycleInstanceId).filter(Boolean))]), recovery_instance_ids: JSON.stringify([...new Set(recovery.flatMap(task => snapshot.turns.filter(turn => turn.task_id === task.id && turn.owner).map(turn => JSON.parse(turn.owner).binding?.lifecycleInstanceId).filter(Boolean)))]), first_user_text: payload(tasks[0]).text ?? null };
		}).sort((a, b) => b.last_activity_at - a.last_activity_at || b.sequence - a.sequence);
		const conversationId = conversations.find(row => row.id === view.conversationId)?.id ?? conversations.find(row => !row.archived_at)?.id ?? null;
		const roots = snapshot.tasks.filter(task => task.conversation_id === conversationId && !task.parent_task_id);
		const eligible = roots.filter(task => task.sequence < (view.before ?? Infinity));
		const page = eligible.slice(-20);
		const visible = new Set([...page, ...roots.filter(task => this.isLive(task) || (task.state === "uncertain" && !snapshot.recoveries.some(row => row.task_id === task.id)))].map(task => task.id));
		const tasks = snapshot.tasks.filter(task => visible.has(task.id) || visible.has(task.root_task_id) || visible.has(task.parent_task_id));
		const ids = new Set(tasks.map(task => task.id));
		const result = { ...snapshot, conversations, tasks, conversationSession: { id: "mock-conversation-session", afterConversationSequence: 0 }, operations: [], reservations: [], attachments: [], dependencies: [], history: { conversationId, before: view.before ?? null, hasOlder: eligible.length > 20, oldestSequence: page[0]?.sequence ?? null, pageTaskIds: tasks.filter(task => page.some(root => root.id === task.id || root.id === task.root_task_id || root.id === task.parent_task_id)).map(task => task.id) } };
		for (const key of ["turns", "events", "records", "recoveries", "questions", "inputs"]) result[key] = snapshot[key].filter(row => ids.has(row.task_id));
		// Use stable event IDs, as the real journal does, for message identity.
		for (const event of snapshot.events) { event.id ??= this.nextEventId++; event.created_at ??= Date.now(); }
		const projected = [];
		const current = new Map();
		for (const row of result.events) {
			const payload = JSON.parse(row.payload);
			if (payload.type === "messages") {
				for (let i = projected.length - 1; i >= 0; i--) if (JSON.parse(projected[i].payload).turnId === payload.turnId) projected.splice(i, 1);
				current.delete(payload.turnId);
				projected.push(row);
			} else if (payload.type === "agent_event") {
				const event = payload.event;
				if (event.type === "message_start" && event.message?.role === "assistant") {
					const message = { ...row, payload: "" };
					const data = { type: "assistant_message", turnId: payload.turnId, messageId: `assistant:${payload.turnId}:${row.id}`, message: { role: "assistant", content: [] }, streaming: true };
					message.payload = JSON.stringify(data);
					current.set(payload.turnId, { message, data });
					projected.push(message);
				} else if (event.type === "message_update" || event.type === "message_end") {
					const saved = current.get(payload.turnId);
					if (!saved) continue;
					if (event.type === "message_end") { saved.data.message = event.message; saved.data.streaming = false; }
					else {
						const update = event.assistantMessageEvent ?? {};
						const type = update.type === "thinking_delta" ? "thinking" : update.type === "text_delta" ? "text" : null;
						if (type) {
							let part = saved.data.message.content.find(part => part.type === type);
							if (!part) saved.data.message.content.push(part = { type, [type]: "" });
							part[type] += update.delta ?? update.text ?? "";
						}
					}
					saved.message.payload = JSON.stringify(saved.data);
				}
			} else projected.push(row);
		}
		result.events = projected;
		result.records = result.records.filter(row => row.kind === "scheduling");
		return result;
	}
	command(command) {
		const { snapshot } = this;
		switch (command.type) {
			case "snapshot":
				if (command.conversationId) this.view = { conversationId: command.conversationId, before: command.before };
				this.publish();
				return null;
			case "create_conversation": {
				const sequence = this.nextConversation++;
				const id = `conversation-${sequence}`;
				this.view = { conversationId: id };
				snapshot.conversations.push({ id, sequence, created_at: Date.now(), archived_at: null, title: sequence === 1 && this.scenario !== "empty" ? "Facade study" : command.title });
				snapshot.sessions.push({ id: `${id}-session`, conversation_id: id });
				if (sequence === 1) {
					seedScenario(snapshot, this.scenario, id);
					if (this.scenario === "running") this.submit({ conversationId: id, sessionId: `${id}-session`, kind: "follow_up", text: "Then export a clash report as CSV.", bindings: [facade], messageTarget: facade, attachments: [] });
				}
				this.publish();
				return { conversationId: id };
			}
			case "archive_conversation":
			case "unarchive_conversation":
			case "delete_conversation": {
				const row = snapshot.conversations.find(row => row.id === command.conversationId);
				if (!row) throw new Error("Thread no longer exists");
				if (command.type !== "unarchive_conversation" && snapshot.tasks.some(task => task.conversation_id === row.id && this.isLive(task))) throw new Error("Stop the running thread first");
				if (command.type === "delete_conversation") this.deleteConversation(row.id);
				else row.archived_at = command.type === "archive_conversation" ? Date.now() : null;
				this.publish();
				return { conversationId: row.id, cleanupPending: 0 };
			}
			case "purge_archived_conversations": {
				const rows = this.browserSnapshot().conversations;
				for (const id of command.conversationIds) {
					const row = rows.find(row => row.id === id);
					if (!row?.archived_at || row.live_state || row.recovery_required || (command.before !== null && row.last_activity_at >= command.before)) throw new Error("These threads changed. Close this dialog and review the cleanup again.");
				}
				for (const id of command.conversationIds) this.deleteConversation(id);
				this.publish();
				return { conversationIds: command.conversationIds, cleanupPending: 0 };
			}
			case "submit":
				return this.submit(command);
			case "steer": {
				const task = this.taskInConversation(command.taskId, command.conversationId);
				if (task.state !== "running" || task.session_id !== command.sessionId || !snapshot.turns.some(turn => turn.id === command.turnId && turn.task_id === task.id && turn.state === "running")) throw new Error("Turn is no longer running");
				snapshot.inputs.push({ id: snapshot.inputs.length + 1, task_id: command.taskId, turn_id: command.turnId, state: "applied", payload: JSON.stringify({ text: command.text, attachments: command.attachments }) });
				this.publish();
				return { inputId: snapshot.inputs.length };
			}
			case "answer": {
				const question = snapshot.questions.find((question) => question.id === command.questionId);
				if (!question || question.answer !== null) throw new Error("Question is no longer pending");
				const task = this.taskInConversation(question.task_id, command.conversationId);
				if (task.state !== "awaiting_user") throw new Error("Question is not answerable");
				question.answer = JSON.stringify(command.answer);
				for (const turn of snapshot.turns) if (turn.task_id === task.id && turn.state === "running") { turn.state = "completed"; turn.ended_at = Date.now(); }
				const continuationId = `turn-${randomUUID()}`;
				question.continuation_id = continuationId;
				snapshot.turns.push({ id: continuationId, task_id: task.id, state: "running", started_at: Date.now() });
				if (task) {
					task.state = "running";
					this.later(1_500, () => {
						if (task.state !== "running") return;
						const turnId = snapshot.turns.find(turn => turn.task_id === task.id && turn.state === "running")?.id;
						snapshot.events.push(messagesEvent(task.id, turnId, [{ role: "assistant", content: [{ type: "text", text: command.answer === null ? "Skipped the spacing question. No model changes were made." : `Using **${command.answer}**. Rebuilt the mullion grid on the roof model.` }] }]));
						this.finish(task, "completed");
					});
				}
				this.publish();
				return null;
			}
			case "cancel": {
				const task = this.taskInConversation(command.taskId, command.conversationId);
				for (const child of snapshot.tasks.filter(child => child.parent_task_id === task.id || child.root_task_id === task.id)) if (this.isLive(child)) this.finish(child, "cancelled");
				if (this.isLive(task)) this.finish(task, "cancelled");
				this.publish();
				return null;
			}
			case "recover": {
				const task = this.taskInConversation(command.taskId, command.conversationId);
				if (task.state !== "uncertain") throw new Error("Task is not uncertain");
				if (!command.acknowledgement?.trim()) throw new Error("Acknowledge inspection before releasing unknown work");
				const id = randomUUID();
				snapshot.recoveries.push({ id, task_id: task.id, created_at: Date.now(), payload: JSON.stringify({ acknowledged: true, inspectedBaseline: { acknowledgement: command.acknowledgement } }) });
				this.publish();
				return { id };
			}
			case "set_model": {
				const model = snapshot.runtime.models.find((model) => model.provider === command.provider && model.id === command.modelId);
				if (!model) throw new Error("Unknown model");
				snapshot.runtime.model = model;
				this.publish();
				return null;
			}
			case "set_thinking":
				if (!snapshot.runtime.availableThinkingLevels.includes(command.level)) throw new Error("Invalid thinking level");
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
		if (!snapshot.conversations.some(row => row.id === command.conversationId && !row.archived_at)) throw new Error("Thread is unavailable or archived");
		const id = `task-${randomUUID().slice(0, 8)}`;
		const turnId = `turn-${id}`;
		const now = Date.now();
		snapshot.tasks.push({ id, conversation_id: command.conversationId, parent_task_id: null, state: "queued", session_id: command.sessionId, created_at: now, updated_at: now, payload: JSON.stringify({ kind: command.kind, text: command.text, bindings: command.bindings, messageTarget: command.messageTarget, attachments: command.attachments }) });
		snapshot.turns.push({ id: turnId, task_id: id, state: "queued" });
		const task = this.task(id);
		const turn = snapshot.turns.find((turn) => turn.id === turnId);
		const busy = snapshot.tasks.some((other) => other.id !== id && other.parent_task_id === null && other.conversation_id === command.conversationId && ["running", "suspending", "awaiting_user"].includes(other.state));
		const start = () => {
			if (task.state !== "queued") return;
			if (snapshot.tasks.some(other => other.id !== id && !other.parent_task_id && other.conversation_id === command.conversationId && ["running", "suspending", "awaiting_user"].includes(other.state))) { this.later(500, start, false); return; }
			task.state = "running";
			turn.state = "running";
			turn.started_at = Date.now();
			turn.owner = JSON.stringify({ binding: command.messageTarget ?? command.bindings[0] });
			snapshot.events.push(agentEvent(id, turnId, { type: "message_start", message: { role: "assistant" } }));
			const words = `Working on "${command.text.trim()}" in ${command.bindings.length} Rhino document${command.bindings.length === 1 ? "" : "s"}. This is a mock answer, so nothing changed in Rhino, but the layout you see here matches a real streaming reply.`.split(" ");
			words.forEach((word, index) => this.later(400 + index * 90, () => {
				if (task.state !== "running") return;
				snapshot.events.push(agentEvent(id, turnId, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${index ? " " : ""}${word}` } }));
			}));
			this.later(400 + words.length * 90 + 800, () => {
				if (task.state !== "running") return;
				snapshot.events.push(messagesEvent(id, turnId, [{ role: "assistant", content: [{ type: "text", text: words.join(" ") }] }]));
				this.finish(task, "completed");
			});
		};
		if (busy) {
			// Queued follow-ups start once the active task settles; poll rather than model the scheduler.
			const poll = () => {
				if (task.state !== "queued") return;
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
