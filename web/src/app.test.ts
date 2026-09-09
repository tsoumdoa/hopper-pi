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
	constructor() {
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
	const input = container.querySelector<
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
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
it("captures explicit replacement save policy and clears save authority on discard", async () => {
	await act(async () => byText("New Rhino document").click());
	await value('select[aria-label="Modified document policy"]', "save");
	await value('input[aria-label="Replacement save path"]', "/models/copy.3dm");
	await act(async () =>
		container
			.querySelector<HTMLInputElement>(
				'input[aria-label="Allow overwriting the save destination"]',
			)!
			.click(),
	);
	await value("#composer-input", "Create a new document");
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	expect(command.documentAction).toMatchObject({
		modifiedPolicy: "save",
		savePath: "/models/copy.3dm",
		overwrite: true,
	});
	await act(async () =>
		socket.receive({
			type: "command_accepted",
			requestId: command.requestId,
			result: { taskId: "task" },
		}),
	);
	await act(async () => byText("New Rhino document").click());
	await value('select[aria-label="Modified document policy"]', "save");
	await value('input[aria-label="Replacement save path"]', "/models/stale.3dm");
	await value('select[aria-label="Modified document policy"]', "discard");
	await value("#composer-input", "Replace with explicit discard");
	await act(async () => sendButton().click());
	const second = socket.sent
		.filter((command) => command.type === "submit")
		.at(-1);
	expect(second.documentAction.modifiedPolicy).toBe("discard");
	expect(second.documentAction).not.toHaveProperty("savePath");
	expect(second.documentAction).not.toHaveProperty("overwrite");
});
it("launch starts a coordinator without inheriting selected document bindings", async () => {
	expect(container.textContent).toContain("Facade.3dm");
	await act(async () =>
		container
			.querySelector<HTMLInputElement>('input[type="checkbox"]')!
			.click(),
	);
	await act(async () => byText("Launch Rhino 8").click());
	await value("#composer-input", "Launch Rhino");
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	expect(command.bindings).toEqual([]);
	expect(command.launch.installationId).toBe("rhino");
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
it("late acceptance in another conversation cannot erase the new draft or authorization", async () => {
	await value("#composer-input", "First task");
	await act(async () => sendButton().click());
	const command = socket.sent.find((command) => command.type === "submit");
	await act(async () => byText("Second").click());
	await value("#composer-input", "Second task");
	await act(async () => byText("New Rhino document").click());
	await act(async () =>
		socket.receive({
			type: "command_accepted",
			requestId: command.requestId,
			result: { taskId: "task" },
		}),
	);
	expect(
		container.querySelector<HTMLTextAreaElement>("#composer-input")!.value,
	).toBe("Second task");
	expect(
		container.querySelector('select[aria-label="Modified document policy"]'),
	).not.toBeNull();
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
	expect(details.textContent).toContain("query Rhino Objects is running");
	expect(container.textContent).not.toContain("tokens");
	expect(container.textContent).not.toContain("Task history");
	expect(container.textContent).not.toContain("/retained/geometry.3dm");
	expect(container.textContent).not.toContain("SHA-256");
	expect(details.nextElementSibling!.textContent).toContain("Next task");
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
it("switches document kind with a fresh safe replacement policy", async () => {
	await act(async () => byText("New Rhino document").click());
	await value('select[aria-label="Modified document policy"]', "save");
	await value('input[aria-label="Replacement save path"]', "/models/rhino.3dm");
	await value('select[aria-label="Document action kind"]', "grasshopper");
	expect(
		container.querySelector<HTMLSelectElement>(
			'select[aria-label="Modified document policy"]',
		)!.value,
	).toBe("refuse");
	expect(
		container.querySelector('input[aria-label="Replacement save path"]'),
	).toBeNull();
	await value("#composer-input", "Create a canvas");
	await act(async () => sendButton().click());
	expect(
		socket.sent.find((command) => command.type === "submit").documentAction,
	).toMatchObject({ kind: "grasshopper", modifiedPolicy: "refuse" });
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
it("shows available documents and the explicit destination in the normal UI", async () => {
	const targets = container.querySelector(
		'details[aria-label="Rhino targets"]',
	)!;
	expect((targets as HTMLDetailsElement).open).toBe(false);
	expect(targets.textContent).not.toContain("PID 42");
	expect(targets.textContent).not.toContain("ready");
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("Chat only");
	await act(async () =>
		targets.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
	);
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("Facade.3dm");
	await value("#composer-input", "Edit the selected document");
	await act(async () => sendButton().click());
	expect(
		socket.sent.find((command) => command.type === "submit").bindings,
	).toEqual([binding]);
	expect(location.pathname).toBe("/");
	expect(container.textContent).not.toContain("Shared host");
});
it("does not silently switch a selected destination when its Rhino disconnects", async () => {
	await act(async () =>
		container
			.querySelector<HTMLInputElement>('input[type="checkbox"]')!
			.click(),
	);
	await value("#composer-input", "Create a sphere");
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: {
				...snapshot,
				targets: [
					{ ...snapshot.targets[0], admission: "detached", documents: [] },
				],
			},
		}),
	);
	expect(sendButton().disabled).toBe(true);
	expect(container.textContent).toContain("Selected document disconnected");
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("Facade.3dm");
	await act(async () => byText("Clear selected targets").click());
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(
		socket.sent.find((command) => command.type === "submit").bindings,
	).toEqual([]);
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
	const choices = container.querySelectorAll<HTMLInputElement>(
		'details[aria-label="Rhino targets"] input[type="checkbox"]',
	);
	await act(async () => choices[1]!.click());
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("Roof.3dm · Rhino 2");
	expect(container.querySelector("article")!.textContent).toContain(
		"Target: Facade.3dm · Rhino 1",
	);
	const newButtons = [...container.querySelectorAll("button")].filter(
		(button) => button.textContent === "New Rhino document",
	);
	await act(async () => newButtons[1]!.click());
	expect(
		container.querySelector('[aria-label="Message destination"]')!.textContent,
	).toContain("New Rhino document · Rhino 2");
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
	await act(async () =>
		container
			.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!
			.click(),
	);
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
	const targets = container.querySelector(
		'details[aria-label="Rhino targets"]',
	)!;
	expect(targets.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
	expect(targets.textContent).toContain("Untitled Rhino document 1");
	expect(targets.textContent).toContain("Untitled Rhino document 2");
	expect(targets.textContent).not.toContain("secret-id");
	expect(targets.textContent).not.toContain("detached");
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

it("selects a visible conversation when a diagnostic-only conversation disappears", async () => {
	await act(async () =>
		socket.receive({
			type: "shared_snapshot",
			snapshot: { ...snapshot, conversations: [snapshot.conversations[1]] },
		}),
	);
	await value("#composer-input", "Continue here");
	await act(async () => sendButton().click());
	expect(
		socket.sent.find((command) => command.type === "submit").conversationId,
	).toBe("other");
});
