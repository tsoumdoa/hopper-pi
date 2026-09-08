import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiTaskDriver } from "./pi-driver.js";
import type { DriverContext } from "./task-service.js";

it("runs real Pi through a durable question and fresh answer turn without replay or double-counted usage", async () => {
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
		dataDirectory: root,
		authPath: join(root, "auth.json"),
		configureSession: (
			session: Parameters<
				NonNullable<
					Parameters<typeof createPiTaskDriver>[1]["configureSession"]
				>
			>[0],
		) => {
			session.agent.streamFunction = (model) => {
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
										name: "ask_user",
										arguments: { question: "Which size?" },
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
		expect(ask).toHaveBeenCalledWith("ask", { question: "Which size?" });
		expect(await first.cleanup()).toMatchObject({ confirmed: true });
		const second = await createPiTaskDriver(
			{
				...context,
				turnId: "second",
				continuation: { questionId: "persisted-question", answer: "Large" },
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
				dataDirectory: root,
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
				dataDirectory: root,
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
