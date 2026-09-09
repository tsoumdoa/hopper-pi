// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./app";
import { HopperStoreProvider } from "./state/hopper-store-context";
vi.mock("./hooks/use-runtime-status", () => ({
	useRuntimeStatus: () => ({ refresh: async () => {}, refreshing: false }),
}));
vi.mock("./components/image-annotation-dialog", () => ({
	ImageAnnotationDialog: () => null,
}));
vi.mock("./lib/image-attachments", async (load) => ({
	...(await load<typeof import("./lib/image-attachments")>()),
	readImage: async (file: File) => ({
		id: file.name,
		name: file.name,
		width: 10,
		height: 10,
		image: { type: "image", mimeType: "image/png", data: btoa(file.name) },
		original: { type: "image", mimeType: "image/png", data: btoa(file.name) },
	}),
}));
class Socket {
	static OPEN = 1;
	static sockets: Socket[] = [];
	readyState = 1;
	sent: any[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	constructor(readonly url: string | URL) {
		Socket.sockets.push(this);
	}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {}
	receive(data: unknown) {
		this.onmessage?.({ data: JSON.stringify(data) });
	}
}
const binding = {
	kind: "rhino",
	lifecycleInstanceId: "life",
	rhinoDocumentId: "model",
};
const snapshot = {
	hostEpoch: "epoch",
	conversations: [
		{ id: "conversation", title: "First" },
		{ id: "other", title: "Second" },
	],
	sessions: [
		{ id: "session", conversation_id: "conversation" },
		{ id: "other-session", conversation_id: "other" },
	],
	tasks: [],
	turns: [],
	events: [],
	recoveries: [],
	questions: [],
	targets: [
		{
			label: "Rhino",
			lifecycleInstanceId: "life",
			processId: 42,
			admission: "ready",
			documents: [binding],
			documentLabels: { model: "Facade.3dm" },
		},
	],
	installations: [{ id: "rhino", build: "8", bootstrapVerified: true }],
	runtime: {
		messages: [],
		thinkingLevel: "off",
		availableThinkingLevels: ["off"],
		model: { provider: "test", id: "test" },
		models: [{ provider: "test", id: "test", input: ["text", "image"] }],
		providers: [],
	},
	eventCursor: 0,
};
let root: Root, container: HTMLDivElement, socket: Socket;
const byText = (text: string) =>
	[...container.querySelectorAll("button")].find(
		(button) => button.textContent === text,
	)!;
const sendButton = () =>
	container.querySelector<HTMLButtonElement>(
		'button[aria-label="Send message"]',
	)!;
async function value(selector: string, text: string) {
	const input = document.querySelector<
		HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
	>(selector)!;
	await act(async () => {
		const prototype =
			input instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: input instanceof HTMLSelectElement
					? HTMLSelectElement.prototype
					: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, text);
		input.dispatchEvent(
			new Event(input instanceof HTMLSelectElement ? "change" : "input", {
				bubbles: true,
			}),
		);
	});
}
async function upload(name: string) {
	const input =
		container.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, "files", {
		configurable: true,
		value: [new File(["image"], name, { type: "image/png" })],
	});
	await act(async () =>
		input.dispatchEvent(new Event("change", { bubbles: true })),
	);
}
beforeEach(async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("WebSocket", Socket);
	Socket.sockets = [];
	history.replaceState(null, "", "/#credential");
	sessionStorage.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () =>
		root.render(
			createElement(HopperStoreProvider, { children: createElement(App) }),
		),
	);
	socket = Socket.sockets[0]!;
	await act(async () => {
		socket.onopen?.();
		socket.receive({ type: "shared_snapshot", snapshot });
	});
	expect(container.querySelector("h1")!.textContent).toBe("New chat");
	const startup = socket.sent.find((command) => command.type === "create_conversation");
	expect(startup.title).toBe("New chat");
	await act(async () => socket.receive({
		type: "command_accepted", requestId: startup.requestId,
		result: { conversationId: "conversation" },
	}));
	socket.sent = [];
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("sends image-only input with the existing image limit and retains it on rejection", async () => {
	await upload("plan.png");
	expect(container.querySelectorAll("img")).toHaveLength(1);
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	expect(command.text).toBe("");
	expect(command.attachments).toEqual([
		{ type: "image", mimeType: "image/png", data: btoa("plan.png") },
	]);
	expect(sendButton().disabled).toBe(true);
	await act(async () =>
		socket.receive({
			type: "error",
			requestId: command.requestId,
			message: "Not accepted",
		}),
	);
	expect(container.querySelectorAll("img")).toHaveLength(1);
	expect(sendButton().disabled).toBe(false);
});
it("late acceptance cannot erase a draft in a new session", async () => {
 await value("#composer-input", "First task");
 await act(async () => sendButton().click());
 const command = socket.sent.find((command) => command.type === "submit");
 await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="New session"]')!.click());
 const create = socket.sent.find((command) => command.type === "create_conversation");
 await act(async () => socket.receive({ type: "command_accepted", requestId: create.requestId, result: { conversationId: "other" } }));
 await value("#composer-input", "Second task");
 await act(async () => socket.receive({ type: "command_accepted", requestId: command.requestId, result: { taskId: "task" } }));
 expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toBe("Second task");
});

it("groups child work under its document without diagnostic history", async () => {
	const rootTask = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "running",
		payload: JSON.stringify({ text: "Compare options", bindings: [] }),
	};
	const nextTask = {
		id: "next",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "queued",
		payload: JSON.stringify({ text: "Next task", bindings: [] }),
	};
	const child = {
		id: "child",
		conversation_id: "conversation",
		parent_task_id: "root",
		state: "running",
		payload: JSON.stringify({ text: "Explore facade", bindings: [binding] }),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [rootTask, nextTask, child],
				turns: [{ id: "turn", task_id: "child", state: "running", usage: 123 }],
				events: [
					{
						task_id: "child",
						kind: "progress",
						payload: JSON.stringify({
							type: "tool_progress",
							phase: "started",
							toolName: "queryRhinoObjects",
							toolCallId: "call",
						}),
					},
				],
				records: [
					{
						kind: "artifact",
						id: "artifact",
						task_id: "child",
						state: "published",
						payload: JSON.stringify({
							format: "3dm",
							units: "Meters",
							objectIds: ["source"],
							checksum: "abc",
							path: "/retained/geometry.3dm",
						}),
					},
				],
			},
		}),
	);
	const article = container.querySelector("article")!,
		details = article.nextElementSibling as HTMLDetailsElement;
	expect(details.tagName).toBe("DETAILS");
	expect(details.open).toBe(false);
	expect(details.querySelector("summary")!.textContent).toContain("Facade.3dm");
	expect(details.querySelector("summary")!.textContent).toContain("Working");
	expect(details.textContent).toContain("queryRhinoObjects");
	expect(details.textContent).toContain("Running");
	expect(container.textContent).not.toContain("tokens");
	expect(container.textContent).not.toContain("Task history");
	expect(container.textContent).not.toContain("/retained/geometry.3dm");
	expect(container.textContent).not.toContain("SHA-256");
	expect(details.nextElementSibling!.textContent).toContain("Next task");
});

it.each(["queued", "running", "suspending", "awaiting_user"])("keeps the Stop button beside the message input while a task is %s", async (state) => {
	const task = { id: "cancel-task", conversation_id: "conversation", parent_task_id: null, state, payload: JSON.stringify({ text: "Create a courtyard", bindings: [binding] }) };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [task] } }));
	const stop = [...container.querySelectorAll<HTMLButtonElement>("footer button")].find(button => button.textContent === "Stop");
	expect(stop).toBeDefined();
	expect(stop!.disabled).toBe(false);
	expect(stop!.classList.contains("border")).toBe(true);
	expect([...container.querySelectorAll('[aria-label="Conversation"] button')].some(button => button.textContent === "Stop")).toBe(false);
	await act(async () => stop!.click());
	expect(socket.sent.find(command => command.type === "cancel")).toMatchObject({ taskId: task.id, conversationId: "conversation" });
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [{ ...task, state: "cancelled" }] } }));
	expect([...container.querySelectorAll("footer button")].some(button => button.textContent === "Stop")).toBe(false);
});

it("stops the active task before queued follow-ups and disables Stop while disconnected", async () => {
	const queued = { id: "queued-task", conversation_id: "conversation", parent_task_id: null, state: "queued", payload: JSON.stringify({ text: "Follow-up", bindings: [binding] }) };
	const running = { ...queued, id: "running-task", state: "running" };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [queued, running] } }));
	const stop = [...container.querySelectorAll<HTMLButtonElement>("footer button")].find(button => button.textContent === "Stop")!;
	await act(async () => stop.click());
	expect(socket.sent.find(command => command.type === "cancel")).toMatchObject({ taskId: running.id });
	await act(async () => socket.onclose?.({ code: 4001, reason: "Replaced by another tab" }));
	expect(stop.disabled).toBe(true);
});
it("keeps assistant output from each turn and the answered question after continuation", async () => {
	const task = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "completed",
		payload: JSON.stringify({ text: "Explore", bindings: [] }),
	};
	const event = (turnId: string, text: string) => ({
		task_id: "root",
		kind: "progress",
		payload: JSON.stringify({
			type: "messages",
			turnId,
			messages: [{ role: "assistant", content: [{ type: "text", text }] }],
		}),
	});
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [task],
				turns: [],
				events: [
					event("first", "Outdated draft"),
					event("first", "First turn result"),
					event("second", "Second turn result"),
				],
				questions: [
					{
						id: "question",
						task_id: "root",
						answer: JSON.stringify("Use meters"),
						payload: JSON.stringify({ question: "Which units?" }),
					},
				],
			},
		}),
	);
	expect(container.textContent).toContain("First turn result");
	expect(container.textContent).toContain("Second turn result");
	expect(container.textContent).toContain("Which units?");
	expect(container.textContent).toContain("Answer: Use meters");
	const article = container.querySelector("article")!;
	expect(
		[...article.children]
			.filter((child) => child.tagName !== "DETAILS")
			.map((child) => child.textContent)
			.join(" "),
	).not.toContain("Outdated draft");
});
it("shows captured tool images as visual child evidence", async () => {
	const rootTask = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "completed",
		payload: JSON.stringify({ text: "Compare", bindings: [] }),
	};
	const child = {
		id: "child",
		conversation_id: "conversation",
		parent_task_id: "root",
		state: "completed",
		payload: JSON.stringify({ text: "Capture", bindings: [binding] }),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [rootTask, child],
				events: [
					{
						task_id: "child",
						kind: "progress",
						payload: JSON.stringify({
							type: "messages",
							turnId: "turn",
							messages: [
								{
									role: "toolResult",
									toolName: "Capture Rhino view",
									toolCallId: "capture",
									content: [
										{ type: "image", mimeType: "image/png", data: "aGk=" },
									],
								},
							],
						}),
					},
				],
			},
		}),
	);
	const image = container.querySelector<HTMLImageElement>(
		'img[alt="Capture from Capture Rhino view"]',
	)!;
	expect(image).not.toBeNull();
	expect(image.src).toContain("data:image/png;base64,aGk=");
});

it("requires inspection for launch recovery and preserves the original outcome after confirmation", async () => {
	const task = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "cancelled",
		payload: JSON.stringify({ text: "Launch Rhino", bindings: [] }),
	};
	const launch = {
		kind: "launch",
		id: "original-launch",
		task_id: "root",
		state: "cancelled",
		payload: JSON.stringify({
			dispatchAttempted: true,
			request: { installationId: "rhino", independentProcess: false },
			detail: "Registration outcome unknown",
		}),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				installations: [{ id: "rhino", platform: "darwin" }],
				tasks: [task],
				records: [launch],
			},
		}),
	);
	const button = byText("Acknowledge and verify launch recovery");
	expect(button.disabled).toBe(true);
	await value(
		'textarea[aria-label="Launch recovery inspection"]',
		"Inspected startup dialogs and closed Rhino",
	);
	await act(async () => button.click());
	expect(
		socket.sent.find((command) => command.type === "recover_launch"),
	).toMatchObject({
		conversationId: "conversation",
		taskId: "root",
		launchRequestId: "original-launch",
		acknowledgement: "Inspected startup dialogs and closed Rhino",
	});
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [task],
				records: [
					launch,
					{
						kind: "launch_recovery",
						id: "original-launch",
						task_id: "root",
						state: "confirmed",
						payload: "{}",
					},
				],
			},
		}),
	);
	expect(container.textContent).toContain("Original launch outcome: cancelled");
	expect(container.textContent).toContain("Ready to launch Rhino again");
	expect(
		container.querySelector(
			'textarea[aria-label="Launch recovery inspection"]',
		),
	).toBeNull();
});
it("keeps unsupported platform launch uncertainty visible without offering recovery", async () => {
	const task = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "cancelled",
		payload: JSON.stringify({ text: "Launch", bindings: [] }),
	};
	const launch = {
		kind: "launch",
		id: "launch",
		task_id: "root",
		state: "uncertain",
		payload: JSON.stringify({
			dispatchAttempted: true,
			request: { installationId: "rhino", independentProcess: false },
		}),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				installations: [{ id: "rhino", platform: "linux" }],
				tasks: [task],
				records: [launch],
			},
		}),
	);
	expect(container.textContent).toContain("Original launch outcome: uncertain");
	expect(container.textContent).toContain(
		"Automatic launch recovery is unavailable",
	);
	expect(
		container.querySelector(
			'textarea[aria-label="Launch recovery inspection"]',
		),
	).toBeNull();
});

it("offers conservative inspected recovery for Windows independent launches", async () => {
	const task = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "cancelled",
		payload: JSON.stringify({ text: "Launch", bindings: [] }),
	};
	const launch = {
		kind: "launch",
		id: "launch",
		task_id: "root",
		state: "uncertain",
		payload: JSON.stringify({
			dispatchAttempted: true,
			request: { installationId: "rhino", independentProcess: true },
		}),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				installations: [{ id: "rhino", platform: "win32" }],
				tasks: [task],
				records: [launch],
			},
		}),
	);
	expect(container.textContent).toContain("close all Rhino processes");
	expect(
		container.querySelector(
			'textarea[aria-label="Launch recovery inspection"]',
		),
	).not.toBeNull();
});
async function chooseModel(label: string) {
 await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rhino model"]')!.click());
 const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes(label))!;
 await act(async () => option.click());
}
it("only shows a Rhino model picker inside the composer and hides conversation history", async () => {
 const picker = container.querySelector('[aria-label="Rhino model"]')!;
 expect(picker.closest("form")!.querySelector("#composer-input")).not.toBeNull();
 expect(container.querySelector('[aria-label="Rhino targets"]')).toBeNull();
 expect(container.textContent).not.toContain("Second");
 for (const label of ["New Rhino document", "Open Rhino document", "Launch Rhino", "Modified document policy"]) {
  expect(container.textContent).not.toContain(label);
 }
 await value("#composer-input", "Edit the selected document");
 await act(async () => sendButton().click());
 const command = socket.sent.find((command) => command.type === "submit");
 expect(command.bindings).toEqual([binding]);
 expect(command).not.toHaveProperty("documentAction");
 expect(command).not.toHaveProperty("launch");
});
it("blocks sending when the selected model disconnects without disabling the draft", async () => {
 await value("#composer-input", "Create a sphere");
 await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [{ ...snapshot.targets[0], admission: "detached", documents: [] }] } }));
 expect(sendButton().disabled).toBe(true);
 expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.disabled).toBe(false);
 expect(container.textContent).toContain("Selected model disconnected");
 expect(container.querySelector('[aria-label="Message destination"]')!.textContent).toContain("Facade.3dm");
 await act(async () => socket.receive({ type: "shared_snapshot", snapshot }));
 expect(sendButton().disabled).toBe(false);
});
it("keeps a task target distinct from the next message selection", async () => {
	const otherBinding = {
		kind: "rhino",
		lifecycleInstanceId: "other-life",
		rhinoDocumentId: "other-model",
	};
	const task = {
		id: "root",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "completed",
		payload: JSON.stringify({ text: "Created in facade", bindings: [binding] }),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [task],
				targets: [
					...snapshot.targets,
					{
						label: "Rhino",
						lifecycleInstanceId: "other-life",
						processId: 43,
						admission: "ready",
						documents: [otherBinding],
						documentLabels: { "other-model": "Roof.3dm" },
					},
				],
			},
		}),
	);
	await chooseModel("Roof.3dm");
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("Roof.3dm · Rhino 2");
	expect(container.querySelector("article")!.textContent).toContain(
		"Target: Facade.3dm · Rhino 1",
	);
	await value("#composer-input", "Edit the roof");
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "submit").bindings).toEqual([otherBinding]);
});
it("preserves normal sidebar controls and exports the selected durable conversation", async () => {
	expect(
		container.querySelector('button[aria-label="Export session"]'),
	).not.toBeNull();
	expect(container.textContent).toContain("Skills & Markdown");
	expect(container.textContent).toContain("Agent tools");
	const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 409 });
	vi.stubGlobal("fetch", fetcher);
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('button[aria-label="Export session"]')!
			.click(),
	);
	expect(fetcher).toHaveBeenCalledWith(
		"/api/session/export?conversationId=conversation",
		expect.objectContaining({
			headers: { Authorization: "Bearer credential" },
		}),
	);
	expect(container.textContent).toContain("Export failed (409)");
});
it("defaults to a follow-up while a task runs and returns to a new task afterward", async () => {
	const task = {
		id: "root",
		session_id: "session",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "running",
		payload: JSON.stringify({ text: "First task", bindings: [] }),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: { ...snapshot, tasks: [task] },
		}),
	);
	await value("#composer-input", "Then inspect the roof");
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	expect(command.kind).toBe("follow_up");
	await act(async () => {
		socket.receive({
			type: "command_accepted",
			requestId: command.requestId,
			result: { taskId: "next" },
		});
		socket.receive({
			type: "shared_snapshot",
			snapshot: { ...snapshot, tasks: [{ ...task, state: "completed" }] },
		});
	});
	await value("#composer-input", "Start another task");
	await act(async () => sendButton().click());
	expect(
		socket.sent.filter((command) => command.type === "submit").at(-1).kind,
	).toBe("prompt");
});
it("shows the active turn target when steering instead of the next selected destination", async () => {
	const oldBinding = {
		kind: "rhino",
		lifecycleInstanceId: "life",
		rhinoDocumentId: "old-model",
	};
	const task = {
		id: "root",
		session_id: "session",
		conversation_id: "conversation",
		parent_task_id: null,
		state: "running",
		payload: JSON.stringify({
			text: "Work in old model",
			bindings: [oldBinding],
		}),
	};
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [task],
				turns: [
					{
						id: "turn",
						task_id: "root",
						state: "running",
						owner: JSON.stringify({ binding }),
					},
				],
				targets: [
					{
						...snapshot.targets[0],
						documents: [binding, oldBinding],
						documentLabels: { model: "Facade.3dm", "old-model": "Old.3dm" },
					},
				],
			},
		}),
	);
	await chooseModel("Old.3dm");
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Message delivery"]',
			)!
			.click(),
	);
	const option = [
		...document.querySelectorAll<HTMLElement>('[role="option"]'),
	].find((option) => option.textContent?.includes("Steer"))!;
	await act(async () => option.click());
	const destination = container.querySelector(
		'[aria-label="Message destination"]',
	)!.textContent;
	expect(destination).toContain("Steering: Facade.3dm");
	expect(destination).not.toContain("Old.3dm");
	await value("#composer-input", "Make it larger");
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "steer")).toMatchObject(
		{ taskId: "root", turnId: "turn" },
	);
});

it("hides stale instances and gives unnamed available documents readable choices", async () => {
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				targets: [
					{
						...snapshot.targets[0],
						lifecycleInstanceId: "stale-life",
						admission: "detached",
						documents: [
							{
								...binding,
								lifecycleInstanceId: "stale-life",
								rhinoDocumentId: "stale-secret-id",
							},
						],
						documentLabels: {},
					},
					{
						...snapshot.targets[0],
						documents: [
							binding,
							{ ...binding, rhinoDocumentId: "second-secret-id" },
						],
						documentLabels: {},
					},
				],
			},
		}),
	);
	await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rhino model"]')!.click());
 const options = [...document.querySelectorAll('[role="option"]')];
 expect(options).toHaveLength(2);
 expect(options.map((option) => option.textContent).join(" ")).toContain("Untitled Rhino document 1");
 expect(options.map((option) => option.textContent).join(" ")).toContain("Untitled Rhino document 2");
 expect(options.map((option) => option.textContent).join(" ")).not.toContain("secret-id");
});

it("keeps submitted images and steering messages visible without diagnostic history", async () => {
	const attachment = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				tasks: [
					{
						id: "root",
						conversation_id: "conversation",
						parent_task_id: null,
						state: "completed",
						payload: JSON.stringify({
							text: "Use this sketch",
							bindings: [],
							attachments: [attachment],
						}),
					},
				],
				inputs: [
					{
						id: 1,
						task_id: "root",
						state: "applied",
						payload: JSON.stringify({
							text: "Make it blue",
							attachments: [attachment],
						}),
					},
					{
						id: 2,
						task_id: "root",
						state: "not_applied",
						payload: JSON.stringify({ text: "Make it taller" }),
					},
				],
			},
		}),
	);
	expect(container.querySelector("article")!.textContent).toContain(
		"Make it blue",
	);
	expect(container.querySelector("article")!.textContent).toContain(
		"Make it taller",
	);
	expect(container.querySelector("article")!.textContent).toContain(
		"Not delivered",
	);
	expect(container.querySelectorAll('img[alt="Attached image"]')).toHaveLength(
		2,
	);
	expect(container.textContent).not.toContain("Task history");
});

it("never switches to a historical conversation when the current chat disappears", async () => {
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: { ...snapshot, conversations: [snapshot.conversations[1]], sessions: [snapshot.sessions[1]] },
		}),
	);
	await value("#composer-input", "Continue here");
	await act(async () => sendButton().click());
	expect(sendButton().disabled).toBe(true);
	expect(socket.sent.some((command) => command.type === "submit")).toBe(false);
	expect(container.textContent).not.toContain("Second");
});


it("requires a connected Rhino model before sending", async () => {
 await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [] } }));
 await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="New session"]')!.click());
 const create = socket.sent.find((command) => command.type === "create_conversation");
 await act(async () => socket.receive({ type: "command_accepted", requestId: create.requestId, result: { conversationId: "other" } }));
 await value("#composer-input", "Create a sphere");
 expect(sendButton().disabled).toBe(true);
 expect(container.textContent).toContain("No Rhino models connected");
 await act(async () => socket.receive({ type: "shared_snapshot", snapshot }));
 expect(sendButton().disabled).toBe(false);
});


it("opens a fresh chat without rendering saved test messages and retries startup once on reconnect", async () => {
 await act(async () => root.unmount());
 root = createRoot(container);
 await act(async () => root.render(createElement(HopperStoreProvider, { children: createElement(App) })));
 socket = Socket.sockets.at(-1)!;
 const oldSnapshot = {
  ...snapshot,
  conversations: [{ id: "old-probe", title: "Native first-launch acceptance probe" }],
  tasks: [{ id: "old-task", conversation_id: "old-probe", parent_task_id: null, state: "completed", payload: JSON.stringify({ text: "Explicit native launch acceptance fixture. No model driver is started for this test.", bindings: [] }) }],
 };
 await act(async () => {
  socket.onopen?.();
  socket.receive({ type: "shared_snapshot", snapshot: oldSnapshot });
  socket.receive({ type: "shared_snapshot", snapshot: oldSnapshot });
 });
 expect(container.querySelector("article")).toBeNull();
 expect(container.textContent).not.toContain("acceptance");
 const creates = socket.sent.filter((command) => command.type === "create_conversation");
 expect(creates).toHaveLength(1);
 await act(async () => socket.onclose?.({ code: 4003, reason: "Disconnected" }));
 // Explicit reconnect avoids timers and must reuse the pending startup request.
 await act(async () => byText("Retry").click());
 const reconnected = Socket.sockets.at(-1)!;
 await act(async () => {
  reconnected.onopen?.();
  reconnected.receive({ type: "shared_snapshot", snapshot: oldSnapshot });
 });
 expect(reconnected.sent.filter((command) => command.type === "create_conversation")).toEqual(creates);
 await act(async () => reconnected.receive({ type: "command_accepted", requestId: creates[0].requestId, result: { conversationId: "fresh" } }));
 await act(async () => reconnected.receive({
  type: "shared_snapshot",
  snapshot: { ...oldSnapshot, conversations: [...oldSnapshot.conversations, { id: "fresh", title: "New chat" }], sessions: [{ id: "fresh-session", conversation_id: "fresh" }] },
 }));
 expect(container.querySelector("article")).toBeNull();
 await value("#composer-input", "Hello");
 await act(async () => sendButton().click());
 expect(reconnected.sent.find((command) => command.type === "submit")).toMatchObject({ conversationId: "fresh", sessionId: "fresh-session", text: "Hello" });
});


it("counts working time from the saved start and freezes the completed duration", async () => {
 vi.useFakeTimers();
 const startedAt = 1_800_000_000_000;
 vi.setSystemTime(startedAt + 12_000);
 const task = {
  id: "timed-task", session_id: "session", conversation_id: "conversation",
  parent_task_id: null, state: "running", created_at: startedAt - 30_000,
  updated_at: startedAt, payload: JSON.stringify({ text: "Build a roof", bindings: [binding] }),
 };
 const turn = { id: "timed-turn", task_id: task.id, state: "running", started_at: startedAt };
 try {
  await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [task], turns: [turn] } }));
  expect(container.querySelector("article")!.textContent).toContain("Working for 12s");
  expect(container.querySelector("header")!.textContent).toContain("Working for 12s");
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(container.querySelector("article")!.textContent).toContain("Working for 13s");
  // A fresh snapshot must not reset the running clock.
  await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [task], turns: [turn] } }));
  expect(container.querySelector("article")!.textContent).toContain("Working for 13s");
  const completed = { ...snapshot, tasks: [{ ...task, state: "completed", updated_at: startedAt + 65_000 }], turns: [{ ...turn, state: "completed", ended_at: startedAt + 65_000 }] };
  await act(async () => socket.receive({ type: "shared_snapshot", snapshot: completed }));
  expect(container.querySelector("article")!.textContent).toContain("Worked for 1m 5s");
  await act(async () => vi.advanceTimersByTime(120_000));
  await act(async () => socket.receive({ type: "shared_snapshot", snapshot: completed }));
  expect(container.querySelector("article")!.textContent).toContain("Worked for 1m 5s");
  expect(container.querySelector("header")!.textContent).toContain("Ready");
 } finally {
  vi.useRealTimers();
	}
});

it("presents an active ask_user question as selectable choices and sends the selected answer", async () => {
	const task = {
		id: "question-task", session_id: "session", conversation_id: "conversation",
		parent_task_id: null, state: "awaiting_user",
		payload: JSON.stringify({ text: "Choose a size", bindings: [binding] }),
	};
	await act(async () => socket.receive({
		type: "shared_snapshot",
		snapshot: {
			...snapshot,
			tasks: [task],
			questions: [{
				id: "size-question", task_id: task.id, answer: null,
				payload: JSON.stringify({ question: "Which size should I use?", options: ["Small", "Large"] }),
			}],
		},
	}));
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Which size should I use?");
	expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
	expect(document.querySelector("datalist")).toBeNull();
	expect(document.querySelector<HTMLInputElement>('input[value="Large"]')!.disabled).toBe(false);
	expect(document.querySelector("header")!.textContent).toContain("Answer needed");
	expect(sendButton().disabled).toBe(true);
	await act(async () => document.querySelector<HTMLInputElement>('input[value="Large"]')!.click());
	await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Continue")!.click());
	expect(socket.sent.find((command) => command.type === "answer")).toMatchObject({
		questionId: "size-question", answer: "Large",
	});
});

it("shows the tool name and its live and completed state", async () => {
	const task = {
		id: "tool-task", session_id: "session", conversation_id: "conversation",
		parent_task_id: null, state: "running",
		payload: JSON.stringify({ text: "Inspect the model", bindings: [binding] }),
	};
	const call = { type: "toolCall", id: "inspect", name: "rh_query_objects", arguments: { layer: "Walls" } };
	await act(async () => socket.receive({
		type: "shared_snapshot",
		snapshot: {
			...snapshot, tasks: [task],
			events: [
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "messages", turnId: "turn", messages: [{ role: "assistant", content: [call] }] }) },
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "tool_progress", phase: "started", toolName: "rh_query_objects", toolCallId: "inspect" }) },
			],
		},
	}));
	expect(container.textContent).toContain("rh_query_objects");
	expect(container.textContent).toContain("Running");
	await act(async () => socket.receive({
		type: "shared_snapshot",
		snapshot: {
			...snapshot, tasks: [task],
			events: [
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "messages", turnId: "turn", messages: [{ role: "assistant", content: [call] }, { role: "toolResult", toolCallId: "inspect", toolName: "rh_query_objects", content: [{ type: "text", text: "Found 12 objects" }], isError: false }] }) },
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "tool_progress", phase: "completed", toolName: "rh_query_objects", toolCallId: "inspect", isError: false }) },
			],
		},
	}));
	expect(container.textContent).toContain("Done");
});

it("welcomes a fresh chat with prompt suggestions that fill the composer", async () => {
	expect(container.textContent).toContain("What should Hopper build?");
	await act(async () => byText("Check the Rhino model").click());
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toContain("Check the active Rhino document");
	expect(container.querySelector("article")).toBeNull();
});

it("confirms shutting down in a dialog instead of a native prompt and reports host errors as toasts", async () => {
	const nativeConfirm = vi.fn(() => true);
	vi.stubGlobal("confirm", nativeConfirm);
	await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Shut down the Hopper host"]')!.click());
	expect(nativeConfirm).not.toHaveBeenCalled();
	expect(socket.sent.some((command) => command.type === "stop_host")).toBe(false);
	const dialog = document.querySelector('[role="dialog"]')!;
	expect(dialog.textContent).toContain("Shut down the Hopper host?");
	await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Shut down")!.click());
	const stop = socket.sent.find((command) => command.type === "stop_host");
	expect(stop).toMatchObject({ hostEpoch: snapshot.hostEpoch });
	await act(async () => socket.receive({ type: "error", requestId: stop.requestId, message: "Host refused to stop." }));
	expect(container.querySelector("header")!.textContent).not.toContain("Host refused to stop.");
	expect(container.textContent).toContain("Host refused to stop.");
});

it("shows the connection banner while offline and hides it once a snapshot arrives", async () => {
	expect(container.querySelector('[role="status"]')?.textContent ?? "").not.toContain("Connection to the local Hopper host was lost.");
	await act(async () => socket.onclose?.({ code: 1006, reason: "" }));
	expect(container.textContent).toContain("Connection to the local Hopper host was lost.");
	expect(container.querySelector("header")!.textContent).toContain("Offline");
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.disabled).toBe(true);
	await act(async () => byText("Retry").click());
	const reconnected = Socket.sockets.at(-1)!;
	await act(async () => {
		reconnected.onopen?.();
		reconnected.receive({ type: "shared_snapshot", snapshot });
	});
	expect(container.textContent).not.toContain("Connection to the local Hopper host was lost.");
	expect(container.querySelector("header")!.textContent).toContain("Ready");
});

it("renders assistant text and thinking before the turn has finished", async () => {
	const task = {
		id: "streaming-task", session_id: "session", conversation_id: "conversation",
		parent_task_id: null, state: "running",
		payload: JSON.stringify({ text: "Inspect the model", bindings: [binding] }),
	};
	await act(async () => socket.receive({
		type: "shared_snapshot",
		snapshot: {
			...snapshot, tasks: [task],
			events: [
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "agent_event", turnId: "turn", event: { type: "message_start", message: { role: "assistant" } } }) },
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "agent_event", turnId: "turn", event: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Checking the model." } } }) },
				{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "agent_event", turnId: "turn", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I found three objects." } } }) },
			],
		},
	}));
	expect(container.textContent).not.toContain("Checking the model.");
	await act(async () => byText("Thinking").click());
	expect(container.textContent).toContain("Checking the model.");
	expect(container.textContent).toContain("I found three objects.");
});

async function showPickQuestion() {
	const task = {
		id: "pick-task", session_id: "session", conversation_id: "conversation", parent_task_id: null,
		state: "awaiting_user", payload: JSON.stringify({ text: "Choose a size", bindings: [binding] }),
	};
	const next = { ...snapshot, tasks: [task], questions: [{
		id: "pick-question", task_id: task.id, answer: null,
		payload: JSON.stringify({ kind: "pick_option", question: "Which size?", options: [
			{ label: "Small", value: "size-small", description: "Fits the courtyard" },
			{ label: "Large", value: "size-large", description: "More seating" },
		] }),
	}] };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	return next;
}
const dialogButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === label)!;

it("restores the original option modal with descriptions, default selection and an automatic Other choice", async () => {
	await showPickQuestion();
	const dialog = document.querySelector('[role="dialog"]')!;
	expect(dialog.textContent).toContain("Fits the courtyard");
	expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(3);
	expect(dialog.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
	await act(async () => dialogButton("Continue").click());
	expect(socket.sent.find((command) => command.type === "answer")).toMatchObject({ questionId: "pick-question", answer: "Small — Fits the courtyard" });
});

it("accepts a custom Other answer and keeps it through snapshots and target label changes", async () => {
	const next = await showPickQuestion();
	await act(async () => document.querySelector<HTMLInputElement>('input[value="Other"]')!.click());
	await act(async () => dialogButton("Continue").click());
	expect(socket.sent.some((command) => command.type === "answer")).toBe(false);
	const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Medium with a canopy");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("Medium with a canopy");
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...next, targets: [{ ...next.targets[0]!, documentLabels: { model: "Renamed facade.3dm" } }] } }));
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Renamed facade.3dm");
	expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("Medium with a canopy");
	await act(async () => dialogButton("Continue").click());
	expect(socket.sent.find((command) => command.type === "answer")).toMatchObject({ answer: "Other: Medium with a canopy" });
});

it("sends cancellation from the original picker as a null answer", async () => {
	await showPickQuestion();
	await act(async () => dialogButton("Cancel").click());
	expect(socket.sent.find((command) => command.type === "answer")).toMatchObject({ questionId: "pick-question", answer: null });
});

it("queues worker pickers with their captured targets and advances only after an acknowledged answer", async () => {
	const initial = await showPickQuestion();
	const secondBinding = { ...binding, lifecycleInstanceId: "second-life", rhinoDocumentId: "second-model" };
	const parent = { ...initial.tasks[0]!, state: "running" };
	const firstWorker = { ...parent, id: "first-worker", parent_task_id: parent.id, state: "awaiting_user" };
	const secondWorker = { ...firstWorker, id: "second-worker" };
	const firstQuestion = { ...initial.questions[0]!, task_id: firstWorker.id };
	const secondQuestion = { ...firstQuestion, id: "second-question", task_id: secondWorker.id, turn_id: "second-turn" };
	const otherTask = { ...firstWorker, id: "other-task", conversation_id: "other" };
	const otherQuestion = { ...firstQuestion, id: "other-question", task_id: otherTask.id };
	const next = { ...initial, tasks: [parent, firstWorker, secondWorker, otherTask], questions: [firstQuestion, secondQuestion, otherQuestion], turns: [{ id: "second-turn", task_id: secondWorker.id, owner: JSON.stringify({ binding: secondBinding }) }], targets: [
		...snapshot.targets,
		{ ...snapshot.targets[0]!, lifecycleInstanceId: "second-life", processId: 43, documents: [secondBinding], documentLabels: { "second-model": "Garden.3dm" } },
	] };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("1 more waiting");
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Target: Facade.3dm · Rhino 1");
	await act(async () => dialogButton("Continue").click());
	expect(socket.sent.find(command => command.type === "answer")).toMatchObject({ questionId: firstQuestion.id });
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Facade.3dm");
	const answered = { ...next, questions: [{ ...firstQuestion, answer: JSON.stringify("Small") }, secondQuestion, otherQuestion] };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: answered }));
	expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Target: Garden.3dm · Rhino 2");
	expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("more waiting");
	await act(async () => dialogButton("Cancel").click());
	expect(socket.sent.filter(command => command.type === "answer").at(-1)).toMatchObject({ questionId: secondQuestion.id, answer: null });
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...answered, questions: [answered.questions[0], { ...secondQuestion, answer: "null" }, otherQuestion] } }));
	expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
});

it("does not replace an active picker when an earlier worker question finishes cleanup", async () => {
	const initial = await showPickQuestion();
	const earlierTask = { ...initial.tasks[0]!, id: "earlier-worker", parent_task_id: "pick-task", state: "suspending" };
	const earlierQuestion = { ...initial.questions[0]!, id: "earlier-question", task_id: earlierTask.id, payload: JSON.stringify({ question: "Earlier question" }) };
	const next = { ...initial, tasks: [...initial.tasks, earlierTask], questions: [earlierQuestion, ...initial.questions] };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	await act(async () => document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')[1]!.click());
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...next, tasks: [...initial.tasks, { ...earlierTask, state: "awaiting_user" }] } }));
	expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
	expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Which size?");
	expect(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')[1]!.checked).toBe(true);
});

it("keeps earlier assistant responses visible through tool turns and final message persistence", async () => {
	const task = { id: "streaming-task", session_id: "session", conversation_id: "conversation", parent_task_id: null, state: "running", payload: JSON.stringify({ text: "Inspect the model", bindings: [binding] }) };
	const first = { role: "assistant", content: [{ type: "text", text: "I will inspect the courtyard first." }] };
	const last = { role: "assistant", content: [{ type: "text", text: "The courtyard has three objects." }] };
	const event = (event: unknown) => ({ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "agent_event", turnId: "turn", event }) });
	const events = [
		event({ type: "message_start", message: { role: "assistant" } }),
		event({ type: "message_end", message: first }),
		event({ type: "message_start", message: { role: "assistant" } }),
		event({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "inspect", name: "rh_query_objects", arguments: {} }] } }),
		event({ type: "message_start", message: { role: "assistant" } }),
		event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: last.content[0]!.text } }),
	];
	const next = { ...snapshot, tasks: [task], events };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: next }));
	for (const text of [first.content[0]!.text, last.content[0]!.text]) expect(container.textContent!.split(text)).toHaveLength(2);
	expect(container.textContent!.indexOf(first.content[0]!.text)).toBeLessThan(container.textContent!.indexOf(last.content[0]!.text));
	expect(container.querySelectorAll(".animate-blink")).toHaveLength(1);
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...next, tasks: [{ ...task, state: "completed" }], events: [...events, { task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "messages", turnId: "turn", messages: [first, last] }) }] } }));
	for (const text of [first.content[0]!.text, last.content[0]!.text]) expect(container.textContent!.split(text)).toHaveLength(2);
	expect(container.querySelectorAll(".animate-blink")).toHaveLength(0);
});

it("expands live tool cards with input and partial output before the final messages arrive", async () => {
	const task = { id: "live-tools", session_id: "session", conversation_id: "conversation", parent_task_id: null, state: "running", payload: JSON.stringify({ text: "Run script", bindings: [binding] }) };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, tasks: [task], events: [
		{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "tool_progress", turnId: "turn", toolCallId: "call", toolName: "rh_run_script", phase: "started", event: { args: { code: "return 42;" } } }) },
		{ task_id: task.id, kind: "progress", payload: JSON.stringify({ type: "tool_progress", turnId: "turn", toolCallId: "call", toolName: "rh_run_script", phase: "updated", event: { partialResult: { content: [{ type: "text", text: "Evaluating script" }] } } }) },
	] } }));
	await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("rh_run_script"))!.click());
	expect(container.textContent).toContain("Input");
	expect(container.textContent).toContain("Output");
	expect(container.textContent).toContain("return 42;");
	expect(container.textContent).toContain("Evaluating script");
	expect(container.textContent).not.toContain("No details");
});

it("reconnects to the same shared endpoint and retries a captured multi-target command once", async () => {
	vi.useFakeTimers();
	const second = { ...binding, lifecycleInstanceId: "life-2", rhinoDocumentId: "other-model" };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [...snapshot.targets, { ...snapshot.targets[0], lifecycleInstanceId: "life-2", processId: 43, documents: [second] }] } }));
	await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Message target settings"]')!.click());
	const checks = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]');
	await act(async () => checks[1]!.click());
	await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Done")!.click());
	await value("#composer-input", "Compare these models");
	await act(async () => sendButton().click());
	const submitted = socket.sent.find((command) => command.type === "submit");
	expect(submitted.bindings).toEqual([binding, second]);
	await act(async () => socket.onclose?.({ code: 1006, reason: "Network lost" }));
	await act(async () => vi.advanceTimersByTimeAsync(1500));
	const replacement = Socket.sockets.at(-1)!;
	expect(replacement.url.toString()).toBe(socket.url.toString());
	expect(replacement.url.toString()).toContain("/ws-shared");
	await act(async () => { replacement.onopen?.(); replacement.receive({ type: "shared_snapshot", snapshot: { ...snapshot, hostEpoch: "replacement-host" } }); });
	expect(replacement.sent.filter((command) => command.type === "submit")).toEqual([submitted]);
	expect(replacement.sent.filter((command) => command.type === "create_conversation")).toEqual([]);
	expect(replacement.sent[0]).toEqual({ type: "authenticate", token: "credential" });
	await act(async () => replacement.receive({ type: "shared_snapshot", snapshot }));
	expect(replacement.sent.filter((command) => command.type === "submit")).toHaveLength(1);
	await act(async () => replacement.receive({ type: "command_accepted", requestId: submitted.requestId, result: { taskId: "task" } }));
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toBe("");
});

it.each([4001, 4003])("does not take control automatically after close code %s", async (code) => {
	vi.useFakeTimers();
	await act(async () => socket.onclose?.({ code, reason: "Disconnected" }));
	await act(async () => {
		window.dispatchEvent(new Event("online"));
		window.dispatchEvent(new Event("pageshow"));
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(60_000);
	});
	expect(Socket.sockets).toHaveLength(1);
	if (code === 4003) expect(container.textContent).toContain("fresh link");
});

it("ignores late messages, acknowledgements and opens from the replaced socket", async () => {
	await value("#composer-input", "Keep this draft");
	await act(async () => sendButton().click());
	const submitted = socket.sent.find((command) => command.type === "submit");
	await act(async () => socket.onclose?.({ code: 1006, reason: "Lost" }));
	await act(async () => byText("Retry").click());
	const sent = socket.sent.length;
	await act(async () => {
		socket.onopen?.();
		socket.receive({ type: "command_accepted", requestId: submitted.requestId, result: { taskId: "task" } });
		socket.receive({ type: "shared_snapshot", snapshot });
	});
	expect(socket.sent).toHaveLength(sent);
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.disabled).toBe(true);
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toBe("Keep this draft");
	const replacement = Socket.sockets.at(-1)!;
	await act(async () => { replacement.onopen?.(); replacement.receive({ type: "shared_snapshot", snapshot }); });
	expect(replacement.sent).toContainEqual(submitted);
});

it("recovers a silently dead connection after wake and keeps the draft", async () => {
	vi.useFakeTimers();
	await act(async () => socket.onclose?.({ code: 1006, reason: "Lost" }));
	await act(async () => window.dispatchEvent(new Event("online")));
	const replacement = Socket.sockets.at(-1)!;
	await act(async () => { replacement.onopen?.(); replacement.receive({ type: "shared_snapshot", snapshot }); });
	await value("#composer-input", "Preserved after sleep");
	replacement.sent = [];
	await act(async () => window.dispatchEvent(new Event("pageshow")));
	expect(replacement.sent).toEqual([{ type: "snapshot" }]);
	await act(async () => vi.advanceTimersByTimeAsync(10_000));
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.disabled).toBe(true);
	await act(async () => vi.advanceTimersByTimeAsync(1500));
	expect(Socket.sockets).toHaveLength(3);
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toBe("Preserved after sleep");
});

it("bounds connection authentication even when no close event arrives", async () => {
	vi.useFakeTimers();
	await act(async () => socket.onclose?.({ code: 1006, reason: "Lost" }));
	await act(async () => byText("Retry").click());
	await act(async () => Socket.sockets.at(-1)!.onopen?.());
	await act(async () => vi.advanceTimersByTimeAsync(10_000));
	await act(async () => vi.advanceTimersByTimeAsync(1500));
	expect(Socket.sockets).toHaveLength(3);
});

it("accepts a fresh token link on explicit reconnect and removes the fragment", async () => {
	await act(async () => socket.onclose?.({ code: 4003, reason: "Authentication failed" }));
	history.replaceState(null, "", "/#token=replacement-credential");
	await act(async () => byText("Retry").click());
	const replacement = Socket.sockets.at(-1)!;
	await act(async () => replacement.onopen?.());
	expect(replacement.sent[0]).toEqual({ type: "authenticate", token: "replacement-credential" });
	expect(location.hash).toBe("");
});

async function targetSettings() {
	await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Message target settings"]')!.click());
}
async function clickTargetButton(label: string) {
	await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === label)!.click());
}

it("submits one new document grant and clears it only after acceptance", async () => {
	await targetSettings();
	await clickTargetButton("New document");
	await clickTargetButton("Done");
	await value("#composer-input", "Build in a new document");
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	expect(command.documentAction).toEqual({ lifecycleInstanceId: "life", kind: "rhino", action: "new", modifiedPolicy: "refuse" });
	expect(container.querySelector('[aria-label="Message destination"]')!.textContent).toContain("New document");
	await act(async () => socket.receive({ type: "error", requestId: command.requestId, message: "Try again" }));
	expect(container.querySelector('[aria-label="Message destination"]')!.textContent).toContain("New document");
	await act(async () => sendButton().click());
	const retry = socket.sent.filter((command) => command.type === "submit").at(-1)!;
	await act(async () => socket.receive({ type: "command_accepted", requestId: retry.requestId, result: { taskId: "task" } }));
	expect(container.querySelector('[aria-label="Message destination"]')!.textContent).not.toContain("New document");
});

it("requires an open path and retains explicit save policy for a Grasshopper document", async () => {
	await targetSettings();
	await clickTargetButton("Open document");
	await value('[aria-label="Document action kind"]', "grasshopper");
	await clickTargetButton("Done");
	await value("#composer-input", "Open the definition");
	expect(sendButton().disabled).toBe(true);
	await targetSettings();
	await value('[aria-label="Document path to open"]', "/models/definition.gh");
	await value('[aria-label="Modified document policy"]', "save");
	await value('[aria-label="Replacement save path"]', "/models/preserved.gh");
	await clickTargetButton("Done");
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "submit").documentAction).toEqual({ lifecycleInstanceId: "life", kind: "grasshopper", action: "open", modifiedPolicy: "save", path: "/models/definition.gh", savePath: "/models/preserved.gh" });
});

it("allows a verified first Rhino launch with no connected documents", async () => {
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [], installations: [{ ...snapshot.installations[0], platform: "darwin" }] } }));
	await targetSettings();
	await clickTargetButton("Launch Rhino · rhino");
	await clickTargetButton("Done");
	await value("#composer-input", "Start Rhino and create a sphere");
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "submit")).toMatchObject({ bindings: [], launch: { installationId: "rhino", independentProcess: false } });
});

it("hides additional Mac process launch and disables unverified Windows launch", async () => {
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, installations: [{ ...snapshot.installations[0], platform: "darwin" }, { id: "windows", build: "8", platform: "win32", bootstrapVerified: false }] } }));
	await targetSettings();
	expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Launch Rhino · rhino");
	const launch = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Launch Rhino · windows")!;
	expect(launch.disabled).toBe(true);
});

it("leaves multiple initial models for the user to choose and does not retarget as inventory changes", async () => {
	const second = { ...binding, lifecycleInstanceId: "other-life", rhinoDocumentId: "other-model" };
	const two = { ...snapshot, targets: [...snapshot.targets, { ...snapshot.targets[0], lifecycleInstanceId: "other-life", processId: 43, documents: [second], documentLabels: { "other-model": "Garden.3dm" } }] };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: two }));
	await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New session"]')!.click());
	const create = socket.sent.find((command) => command.type === "create_conversation");
	await act(async () => socket.receive({ type: "command_accepted", requestId: create.requestId, result: { conversationId: "other" } }));
	expect(container.querySelector('[aria-label="Message destination"]')!.textContent).toBe("Choose a Rhino model");
	await value("#composer-input", "Edit this model");
	expect(sendButton().disabled).toBe(true);
	await chooseModel("Garden.3dm");
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...two, targets: [...two.targets].reverse() } }));
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "submit").bindings).toEqual([second]);
});

it("lets the user clear the automatic single-document selection", async () => {
	await targetSettings();
	await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
	await clickTargetButton("Done");
	await value("#composer-input", "Keep choosing");
	expect(sendButton().disabled).toBe(true);
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot }));
	expect(sendButton().disabled).toBe(true);
});

it("keeps target identity across snapshots with reordered binding fields", async () => {
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [{ ...snapshot.targets[0], documents: [{ rhinoDocumentId: "model", lifecycleInstanceId: "life", kind: "rhino" }] }] } }));
	await value("#composer-input", "Use the same model");
	expect(sendButton().disabled).toBe(false);
	expect(container.textContent).not.toContain("Selected model disconnected");
});

it("retains a durable command when WebSocket.send throws and retries the same request", async () => {
	await value("#composer-input", "Keep the request");
	const original = socket.send.bind(socket);
	socket.send = (data) => { original(data); throw new Error("Socket closed"); };
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	const replacement = Socket.sockets.at(-1)!;
	expect(replacement).not.toBe(socket);
	await act(async () => { replacement.onopen?.(); replacement.receive({ type: "shared_snapshot", snapshot }); });
	expect(replacement.sent.filter((command) => command.type === "submit")).toEqual([command]);
	expect(container.querySelector<HTMLTextAreaElement>("#composer-input")!.value).toBe("Keep the request");
});

it("includes an explicitly selected Grasshopper canvas in the captured task bindings", async () => {
	const grasshopper = { kind: "grasshopper", lifecycleInstanceId: "life", grasshopperDocumentId: "canvas", associatedRhinoDocumentId: "model" };
	await act(async () => socket.receive({ type: "shared_snapshot", snapshot: { ...snapshot, targets: [{ ...snapshot.targets[0], documents: [binding, grasshopper], documentLabels: { model: "Facade.3dm", canvas: "Facade.gh" } }] } }));
	await targetSettings();
	await act(async () => document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')[1]!.click());
	await clickTargetButton("Done");
	await value("#composer-input", "Compare the model and definition");
	await act(async () => sendButton().click());
	expect(socket.sent.find((command) => command.type === "submit").bindings).toEqual([binding, grasshopper]);
});
