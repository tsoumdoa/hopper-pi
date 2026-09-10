import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createPiTaskDriver } from "./pi-driver.js";
import type { DriverContext } from "./task-service.js";
import { HostSkillLibrary } from "../skills.js";
import { TaskJournal } from "./journal.js";
import { ToolPolicyStore } from "../../services/tool-policy-store.js";
import { HOPPER_POLICY_INVENTORY } from "../../tools/policy-inventory.js";
import { setCachedBackendStatus } from "../../infra/backend-status-cache.js";

it("persists completed child messages with optional SDK fields to the real journal", async () => {
	const root = await mkdtemp(join(tmpdir(), "shared-child-json-"));
	const journal = new TaskJournal(":memory:");
	const target = { kind: "rhino" as const, lifecycleInstanceId: "life", rhinoDocumentId: "doc" };
	journal.registerSession("conversation", "session");
	const parent = journal.accept({ requestId: "parent", conversationId: "conversation", sessionId: "session",
		kind: "prompt", text: "Edit both", bindings: [target], attachments: [] });
	journal.start(parent.taskId, parent.turnId, null);
	const child = journal.delegate({ requestId: "child", parentTaskId: parent.taskId, dependencies: [],
		conversationId: "conversation", sessionId: "worker", kind: "prompt", text: "Finish the edit", bindings: [target], attachments: [] });
	journal.start(child.taskId, child.turnId, null);
	let driver: Awaited<ReturnType<typeof createPiTaskDriver>> | undefined;
	try {
		driver = await createPiTaskDriver({ taskId: child.taskId, turnId: child.turnId, parentTaskId: parent.taskId,
			sessionId: "worker", conversationId: "conversation", binding: null, owner: null, text: "Finish the edit",
			attachments: [], continuation: null, signal: new AbortController().signal,
			ask: () => "question", requestDocumentAction: () => "handoff",
			publish: (payload) => { journal.publish(child.taskId, payload); },
		}, {
			dataDirectory: root, toolConfigDir: join(root, "tool-settings"), authPath: join(root, "auth.json"),
			configureSession(session) {
				session.agent.streamFunction = (model) => {
					const message: AssistantMessage = {
						role: "assistant", api: model.api, provider: model.provider, model: model.id,
						timestamp: Date.now(), stopReason: "stop", errorMessage: undefined,
						content: [{ type: "text", text: "Created hello", textSignature: undefined }],
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					};
					const stream = createAssistantMessageEventStream();
					stream.push({ type: "done", reason: "stop", message });
					return stream;
				};
			},
		});
		expect(await driver.run()).toEqual({ usage: 2 });
		expect(await driver.cleanup()).toMatchObject({ confirmed: true });
		journal.settle(child.taskId, child.turnId, "completed");
		const events = journal.snapshot().events.map((event) => JSON.parse(String(event.payload)));
		expect(events.find((event) => event.type === "messages")?.messages).toEqual(expect.arrayContaining([
			expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "Created hello" }] }),
		]));
	} finally {
		await driver?.cleanup();
		journal.close();
		await rm(root, { recursive: true, force: true });
	}
});

it("continues conversation history across task workspaces and isolates other sessions", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "shared-driver-history-")));
	const context: DriverContext = {
		taskId: "first", turnId: "first-turn", sessionId: "session", conversationId: "conversation",
		binding: null, owner: null, text: "Remember the courtyard width is 42 metres", attachments: [], continuation: null,
		signal: new AbortController().signal, ask: () => "question", requestDocumentAction: () => "handoff", publish: () => {},
	};
	let activeSession: AgentSession;
	const prompts: unknown[] = [];
	const options = {
		dataDirectory: root, toolConfigDir: join(root, "tool-settings"), authPath: join(root, "auth.json"),
		configureSession(session: AgentSession) {
			activeSession = session;
			session.agent.streamFunction = (model, providerContext) => {
				prompts.push(providerContext.messages);
				const message: AssistantMessage = {
					role: "assistant", api: model.api, provider: model.provider, model: model.id,
					timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Width remembered" }],
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				};
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			};
		},
	};
	let driver: Awaited<ReturnType<typeof createPiTaskDriver>> | undefined;
	try {
		for (const taskId of ["first", "second", "third"]) {
			driver = await createPiTaskDriver({ ...context, taskId, turnId: `${taskId}-turn`, text: taskId === "first" ? context.text : `Follow-up ${taskId}` }, options);
			expect(await driver.run()).toEqual({ usage: 2 });
			await driver.cleanup();
			driver = undefined;
		}
		expect(JSON.stringify(prompts[1])).toContain("42 metres");
		expect(JSON.stringify(prompts[2])).toContain("42 metres");
		expect(JSON.stringify(prompts[2])).toContain("Follow-up second");
		expect(await SessionManager.listAll(join(root, "sessions", "conversation", "sessions", "session"))).toHaveLength(1);
		for (const identity of [{ sessionId: "worker" }, { conversationId: "other-conversation" }]) {
			driver = await createPiTaskDriver({ ...context, ...identity, taskId: "isolated" }, options);
			expect(activeSession!.messages).toEqual([]);
			await driver.cleanup();
			driver = undefined;
		}
	} finally {
		await driver?.cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

it.each([
	{ toolName: "ask_user", args: { question: "Which size?" }, answer: "Large" },
	{ toolName: "pick_option", args: { question: "Which size?", options: [
		{ label: "Small", value: "size-small", description: "Compact" }, { label: "Large", value: "size-large" },
	] }, answer: "Large" },
])("runs real Pi $toolName through a durable question and fresh answer turn without replay or double-counted usage", async ({ toolName, args, answer }) => {
	const root = await mkdtemp(join(tmpdir(), "shared-driver-"));
	let providerCalls = 0;
	const publish = vi.fn();
	const ask = vi.fn(() => "persisted-question");
	const context: DriverContext = {
		taskId: "task",
		turnId: "first",
		sessionId: "session",
		conversationId: "conversation",
		binding: null,
		owner: null,
		text: "Ask me a question",
		attachments: [],
		continuation: null,
		signal: new AbortController().signal,
		ask,
		requestDocumentAction: () => "handoff",
		publish,
	};
	const options = {
		dataDirectory: root, toolConfigDir: join(root, "tool-settings"),
		authPath: join(root, "auth.json"),
		configureSession: (
			session: Parameters<
				NonNullable<
					Parameters<typeof createPiTaskDriver>[1]["configureSession"]
				>
			>[0],
		) => {
			expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["pick_option", "ask_user", "read"]));
			session.agent.streamFunction = (model, providerContext) => {
				expect(providerContext.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["pick_option", "ask_user"]));
				if (providerCalls > 0 && toolName === "pick_option") expect(JSON.stringify(providerContext.messages)).toContain("size-large");
				providerCalls++;
				const message: AssistantMessage = {
					role: "assistant",
					api: model.api,
					provider: model.provider,
					model: model.id,
					timestamp: Date.now(),
					stopReason: providerCalls === 1 ? "toolUse" : "stop",
					content:
						providerCalls === 1
							? [
									{
										type: "toolCall",
										id: "ask",
										name: toolName,
										arguments: args,
									},
								]
							: [{ type: "text", text: "Size accepted" }],
					usage: {
						input: 3,
						output: 2,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 5,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
				};
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "done",
					reason: message.stopReason as "stop" | "toolUse",
					message,
				});
				return stream;
			};
		},
	};
	try {
		const first = await createPiTaskDriver(context, options);
		expect(await first.run()).toEqual({ usage: 5 });
		expect(providerCalls).toBe(1);
		const payload = toolName === "pick_option" ? { kind: "pick_option", ...args } : args;
		expect(ask).toHaveBeenCalledWith("ask", payload);
		expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_progress", phase: "started", turnId: "first", event: expect.objectContaining({ args }) }));
		expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_progress", phase: "completed", event: expect.objectContaining({ result: expect.objectContaining({ content: expect.any(Array) }) }) }));
		expect(await first.cleanup()).toMatchObject({ confirmed: true });
		const second = await createPiTaskDriver(
			{
				...context,
				turnId: "second",
				continuation: { questionId: "persisted-question", payload, answer },
			},
			options,
		);
		expect(await second.run()).toEqual({ usage: 5 });
		expect(providerCalls).toBe(2);
		await second.cleanup();
		const manager = SessionManager.continueRecent(
			join(root, "workspaces", "task"),
			join(root, "sessions", "conversation", "sessions", "session"),
		);
		const messages = manager.buildSessionContext().messages;
		expect(messages.filter((m) => m.role === "toolResult")).toMatchObject([
			{
				details: {
					status: "awaiting_user",
					question: { questionId: "persisted-question" },
				},
			},
		]);
		expect(
			messages.filter(
				(m) => m.role === "user" && JSON.stringify(m).includes("Large"),
			),
		).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it.each(["error", "aborted"] as const)(
	"reports terminal provider %s with accounted usage",
	async (stopReason) => {
		const root = await mkdtemp(join(tmpdir(), "shared-driver-failure-"));
		const context: DriverContext = {
			taskId: "task",
			turnId: "turn",
			sessionId: "session",
			conversationId: "conversation",
			binding: null,
			owner: null,
			text: "Run",
			attachments: [],
			continuation: null,
			signal: new AbortController().signal,
			ask: () => "question",
			requestDocumentAction: () => "handoff",
			publish: () => {},
		};
		try {
			const driver = await createPiTaskDriver(context, {
				dataDirectory: root, toolConfigDir: join(root, "tool-settings"),
				authPath: join(root, "auth.json"),
				configureSession: (session) => {
					session.agent.streamFunction = (model) => {
						const message: AssistantMessage = {
							role: "assistant",
							api: model.api,
							provider: model.provider,
							model: model.id,
							timestamp: Date.now(),
							stopReason,
							errorMessage: "Provider unavailable",
							content: [],
							usage: {
								input: 3,
								output: 2,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 5,
								cost: {
									input: 0,
									output: 0,
									cacheRead: 0,
									cacheWrite: 0,
									total: 0,
								},
							},
						};
						const stream = createAssistantMessageEventStream();
						stream.push({ type: "error", reason: stopReason, error: message });
						return stream;
					};
				},
			});
			await expect(driver.run()).rejects.toMatchObject({
				message: "Provider unavailable",
				usage: 5,
			});
			expect(await driver.cleanup()).toMatchObject({ confirmed: true });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
it("cleans a constructed native context when driver initialization fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "shared-driver-setup-"));
	const { RuntimeSessionContext } = await import(
		"../../infra/runtime-session-context.js"
	);
	const binding = {
		kind: "rhino" as const,
		lifecycleInstanceId: "lifecycle",
		rhinoDocumentId: "doc",
	};
	const context: DriverContext = {
		taskId: "task",
		turnId: "turn",
		sessionId: "session",
		conversationId: "conversation",
		binding,
		owner: {
			taskId: "task",
			turnId: "turn",
			binding,
			attachmentGeneration: "g",
		},
		text: "Run",
		attachments: [],
		continuation: null,
		signal: new AbortController().signal,
		ask: () => "question",
		requestDocumentAction: () => "handoff",
		publish: () => {},
	};
	const cleanup = vi.fn(async () => ({ confirmed: false }));
	try {
		await expect(
			createPiTaskDriver(context, {
				dataDirectory: root, toolConfigDir: join(root, "tool-settings"),
				authPath: join(root, "auth.json"),
				model: { provider: "missing", id: "missing" },
				geometry: async () => ({
					runtimeSession: new RuntimeSessionContext({}),
					cleanup,
				}),
			}),
		).rejects.toMatchObject({
			message: "Selected model is unavailable",
			cleanupConfirmed: false,
		});
		expect(cleanup).toHaveBeenCalledTimes(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});


it("applies normal UI skill preferences and thinking to new tasks while retaining an active skill snapshot", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "shared-driver-skills-")));
	const project = join(root, "project");
	const settings = join(root, "normal-host");
	const folder = join(settings, "skills");
	const skillPath = join(folder, "modeling.md");
	const context: DriverContext = {
		taskId: "task", turnId: "first", sessionId: "session", conversationId: "conversation",
		binding: null, owner: null, text: "/skill:modeling Make a sphere", attachments: [], continuation: null,
		signal: new AbortController().signal, ask: () => "question", requestDocumentAction: () => "handoff", publish: () => {},
	};
	let activeSession: AgentSession | undefined;
	const prompts: unknown[] = [];
	const drivers: Awaited<ReturnType<typeof createPiTaskDriver>>[] = [];
	try {
		await mkdir(folder, { recursive: true });
		await writeFile(skillPath, "---\nname: modeling\ndescription: Follow the modeling instructions\n---\nUse the approved sphere procedure.");
		const library = new HostSkillLibrary(project, join(settings, "skills-settings.json"), folder);
		await library.initialize();
		const options = {
			dataDirectory: join(root, "tasks"), authPath: join(root, "auth.json"),
			skillDataDirectory: settings, projectRoot: project, thinkingLevel: "off",
			configureSession(session: AgentSession) {
				activeSession = session;
				session.agent.streamFunction = (model, providerContext) => {
					prompts.push(providerContext.messages);
					const message: AssistantMessage = {
						role: "assistant", api: model.api, provider: model.provider, model: model.id,
						timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Done" }],
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					};
					const stream = createAssistantMessageEventStream();
					stream.push({ type: "done", reason: "stop", message });
					return stream;
				};
			},
		};
		const first = await createPiTaskDriver(context, options);
		drivers.push(first);
		expect(activeSession!.thinkingLevel).toBe("off");
		expect(activeSession!.systemPrompt).toContain("Follow the modeling instructions");
		const read = activeSession!.agent.state.tools.find((tool) => tool.name === "read")!;
		expect(read).toBeDefined();
		expect(JSON.stringify(await read.execute("read", { path: skillPath }))).toContain("approved sphere procedure");
		await expect(read.execute("read", { path: join(root, "auth.json") })).rejects.toThrow("limited to enabled skills");
		// A UI toggle updates the shared preferences; the already admitted task keeps its snapshot.
		await library.update({ type: "toggle", id: library.snapshot().skills[0]!.id, enabled: false });
		await writeFile(skillPath, "Changed after admission");
		await first.run();
		expect(JSON.stringify(prompts[0])).toContain("approved sphere procedure");
		expect(JSON.stringify(prompts[0])).not.toContain("Changed after admission");
		const second = await createPiTaskDriver({ ...context, taskId: "second", sessionId: "second" }, options);
		drivers.push(second);
		expect(activeSession!.systemPrompt).not.toContain("Follow the modeling instructions");
		const disabledRead = activeSession!.agent.state.tools.find((tool) => tool.name === "read")!;
		await expect(disabledRead.execute("read", { path: skillPath })).rejects.toThrow("limited to enabled skills");
		await second.run();
		expect(JSON.stringify(prompts[1])).toContain("/skill:modeling Make a sphere");
		await expect(createPiTaskDriver({ ...context, taskId: "invalid" }, { ...options, thinkingLevel: "invalid" }))
			.rejects.toThrow("Thinking level is unavailable: invalid");
	} finally {
		for (const driver of drivers) await driver.cleanup();
		await rm(root, { recursive: true, force: true });
	}
});


it.each([null, "parent"])("keeps native tools with selected ownership and exposes delegation only to roots: %s", async (parentTaskId) => {
	const root = await mkdtemp(join(tmpdir(), "shared-owned-delegation-"));
	const { RuntimeSessionContext } = await import("../../infra/runtime-session-context.js");
	const { Type } = await import("@earendil-works/pi-ai");
	const binding = { kind: "rhino" as const, lifecycleInstanceId: "selected", rhinoDocumentId: "doc" };
	const other = { ...binding, lifecycleInstanceId: "other" };
	const context: DriverContext = { taskId: "task", turnId: "turn", sessionId: "session", conversationId: "conversation", parentTaskId, binding, messageTarget: binding, accessibleBindings: [binding, other], owner: { taskId: "task", turnId: "turn", binding, attachmentGeneration: "generation" }, text: "Edit this document", attachments: [], continuation: null, signal: new AbortController().signal, ask: () => "question", requestDocumentAction: () => "handoff", publish: () => {} };
	let session: AgentSession | undefined;
	const runtimeSession = new RuntimeSessionContext();
	runtimeSession.run(() => setCachedBackendStatus({ online: true }));
	const driver = await createPiTaskDriver(context, {
		dataDirectory: root, toolConfigDir: join(root, "tool-settings"), authPath: join(root, "auth.json"),
		geometry: async () => ({ runtimeSession, cleanup: async () => ({ confirmed: true }) }),
		delegationTools: () => ["listRhinoTargets", "delegate", "waitForDelegates"].map((name) => ({ name, label: name, description: name, parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }) })),
		configureSession: (created) => { session = created; },
	});
	try {
		const names = session!.agent.state.tools.map((tool) => tool.name);
		expect(names).toContain("rh_run_script");
		for (const name of ["listRhinoTargets", "delegate", "waitForDelegates"])
			expect(names.includes(name)).toBe(parentTaskId === null);
		expect(session!.systemPrompt).toContain("Use your native geometry tools directly for this document");
	} finally {
		await driver.cleanup();
		await rm(root, { recursive: true, force: true });
	}
});


it("applies the host tool profile at model boundaries without losing shared task guidance", async () => {
	const root = await mkdtemp(join(tmpdir(), "shared-policy-boundary-"));
	const toolConfigDir = join(root, "tool-settings");
	const store = new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory: toolConfigDir });
	const prompts: { tools: string[]; systemPrompt: string }[] = [];
	let driver: Awaited<ReturnType<typeof createPiTaskDriver>> | undefined;
	try {
		driver = await createPiTaskDriver({
			taskId: "root", turnId: "turn", parentTaskId: null, sessionId: "session", conversationId: "conversation",
			binding: null, owner: null, text: "Discuss the model", attachments: [], continuation: null,
			signal: new AbortController().signal, ask: () => "question", requestDocumentAction: () => "handoff", publish: () => {},
		}, {
			dataDirectory: root, authPath: join(root, "auth.json"), toolConfigDir,
			configureSession(session) {
				session.agent.streamFunction = (model, context) => {
					prompts.push({ tools: context.tools?.map((tool) => tool.name) ?? [], systemPrompt: context.systemPrompt ?? "" });
					const stream = createAssistantMessageEventStream();
					stream.push({ type: "done", reason: "stop", message: {
						role: "assistant", api: model.api, provider: model.provider, model: model.id,
						timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Done" }],
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					} });
					return stream;
				};
			},
		});
		for (const enabled of [false, true]) {
			await store.update(await store.read(), { target: "tools", id: "hopper.tool.read_skill", enabled });
			await driver.run();
			expect(prompts.at(-1)!.tools.includes("read")).toBe(enabled);
			expect(prompts.at(-1)!.tools).toContain("ask_user");
			expect(prompts.at(-1)!.tools.some((name) => name.startsWith("rh_") || name.startsWith("gh_"))).toBe(false);
			expect(prompts.at(-1)!.systemPrompt.split("Shared task root, turn turn")).toHaveLength(2);
			expect(prompts.at(-1)!.systemPrompt).toContain("root user's message explicitly asks");
		}
	} finally {
		await driver?.cleanup();
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});
