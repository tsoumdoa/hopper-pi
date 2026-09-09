import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Model, type Api } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerPickOptionTool } from "../../extensions/choices/register-pick-option.js";
import { registerAskUserTool } from "../../extensions/choices/register-ask-user.js";
import type { SuspendQuestion } from "../../extensions/choices/ui-helpers.js";
import { createHopperPiExtension } from "../../index.js";
import { serializeAgentEvent } from "../event-serializer.js";
import { RuntimeSessionContext } from "../../infra/runtime-session-context.js";
import { QuestionSuspensionBoundary } from "../question-suspension.js";
import type { DriverContext, TaskDriver } from "./task-service.js";
import type { ImageAttachment } from "../protocol.js";
import { resolvePickOptionAnswer, type PickOption } from "../../types/choices.js";
import { HostSkillLibrary } from "../skills.js";

export interface PiDriverOptions {
	dataDirectory: string;
	authPath: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	/** Normal host preferences directory, shared with the skills UI. */
	skillDataDirectory?: string;
	projectRoot?: string;
	geometry?: (context: DriverContext) => Promise<{
		runtimeSession: RuntimeSessionContext;
		cleanup(): Promise<{ confirmed: boolean; evidence?: unknown }>;
	}>;
	coordinatorTools?: (context: DriverContext) => ToolDefinition[];
	documentActions?: {
		list(): unknown[];
		execute(grantId: string): Promise<unknown>;
	};
	/** Provider injection for deterministic driver tests. */
	configureSession?: (session: AgentSession) => void;
}

export async function createPiTaskDriver(
	context: DriverContext,
	options: PiDriverOptions,
): Promise<TaskDriver> {
	const sessionRoot = join(
		options.dataDirectory,
		"sessions",
		context.conversationId,
		"sessions",
		context.sessionId,
	);
	const workspace = join(options.dataDirectory, "workspaces", context.taskId);
	await Promise.all([
		mkdir(sessionRoot, { recursive: true }),
		mkdir(workspace, { recursive: true }),
	]);
	const geometry = context.binding
		? await options.geometry?.(context)
		: undefined;
	if (context.binding && !geometry)
		throw new Error(
			"Native document routing is not ready for this selected target",
		);
	let boundary: QuestionSuspensionBoundary | undefined;
	let session: AgentSession | undefined;
	let cleanupResult: { confirmed: boolean; evidence?: unknown } | undefined;
	const suspend: SuspendQuestion = async (toolCallId, payload) => {
		if (!boundary) throw new Error("Question boundary is not installed");
		return boundary.suspend({
			questionId: "pending", taskId: context.taskId, turnId: context.turnId,
			sessionId: context.sessionId, toolCallId, question: JSON.stringify(payload),
		});
	};
	const tools: ToolDefinition[] = [
		...(!context.binding ? (options.coordinatorTools?.(context) ?? []) : []),
		...(options.documentActions
			? [
					{
						name: "listDocumentGrants",
						label: "Document grants",
						description:
							"List exact document actions authorized for this root task.",
						parameters: Type.Object({}),
						execute: async () => ({
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(options.documentActions!.list()),
								},
							],
							details: {},
						}),
					},
					{
						name: "executeDocumentGrant",
						label: "Create or open document",
						description:
							"Perform one authorized document action. Direct editing closes its scope and resumes with a fresh binding.",
						parameters: Type.Object({ grantId: Type.String() }),
						execute: async (toolCallId: string, args: { grantId: string }) => {
							if (
								!options
									.documentActions!.list()
									.some((grant: any) => grant.id === args.grantId)
							)
								throw new Error(
									"Document grant is not authorized for this task",
								);
							if (context.binding)
								return boundary!.suspend(
									{
										questionId: "pending",
										taskId: context.taskId,
										turnId: context.turnId,
										sessionId: context.sessionId,
										toolCallId,
										question: JSON.stringify({
											kind: "document_action",
											grantId: args.grantId,
										}),
									},
									"document_handoff",
								);
							const result = await options.documentActions!.execute(
								args.grantId,
							);
							return {
								content: [
									{ type: "text" as const, text: JSON.stringify(result) },
								],
								details: {},
							};
						},
					},
				]
			: []),
	];
	try {
		const skillDataDirectory = options.skillDataDirectory ?? options.dataDirectory;
		// Each task gets a snapshot. Later UI changes apply to the next task without
		// changing the approved files underneath a running model/tool call.
		const skills = new HostSkillLibrary(
			options.projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
			join(skillDataDirectory, "skills-settings.json"),
			join(skillDataDirectory, "skills"),
		);
		await skills.initialize();
		const services = await createAgentSessionServices({
			cwd: workspace,
			agentDir: join(sessionRoot, "agent"),
			modelRuntime: await ModelRuntime.create({
				authPath: options.authPath,
				modelsPath: join(sessionRoot, "agent", "models.json"),
				modelsStorePath: join(sessionRoot, "agent", "models-store.json"),
			}),
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				extensionFactories: [
					{ name: "hopper-choices", factory: (pi) => {
						registerPickOptionTool(pi, suspend);
						registerAskUserTool(pi, suspend);
					} },
					...(geometry ? [
							{
								name: "hopper",
								factory: createHopperPiExtension({
									runtimeSession: geometry.runtimeSession,
									scriptWorkspaceDir: workspace,
									sessionId: () => context.sessionId,
								}),
							},
						]
					: []),
				],
			},
		});
		services.resourceLoader.getSkills = () => skills.getSkills();
		let model: Model<Api> | undefined;
		if (options.model) {
			model = services.modelRuntime.getModel(
				options.model.provider,
				options.model.id,
			);
			if (!model) throw new Error("Selected model is unavailable");
		}
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.continueRecent(workspace, sessionRoot),
			noTools: "builtin",
			customTools: [...tools, skills.createReadTool(workspace)],
			...(model ? { model } : {}),
		});
		session = created.session;
		if (options.thinkingLevel !== undefined) {
			const level = session.getAvailableThinkingLevels().find((candidate) => candidate === options.thinkingLevel);
			if (!level) throw new Error(`Thinking level is unavailable: ${options.thinkingLevel}`);
			session.setThinkingLevel(level);
		}
		await session.bindExtensions({
			mode: "rpc",
			abortHandler: () => {
				void session!.abort();
			},
			onError: (error) =>
				context.publish({ type: "driver_error", message: error.error }),
		});
		session.agent.state.systemPrompt = `${session.systemPrompt}\nShared task ${context.taskId}, turn ${context.turnId}. Captured target: ${JSON.stringify(context.binding)}. Use only the captured document context. A user question ends this turn. Do not assume a new active Rhino window changes your target. If you delegate, call waitForDelegates to collect child results before summarizing. Use listDocumentGrants and executeDocumentGrant for authorized document actions. Additional Mac documents share one Rhino process and must run sequentially.`;
		options.configureSession?.(session);
		boundary = new QuestionSuspensionBoundary(
			session.agent,
			async (question) => {
				const payload = JSON.parse(question.question);
				const id =
					payload.kind === "document_action"
						? context.requestDocumentAction(payload.grantId)
						: context.ask(question.toolCallId, payload);
				// The result must carry the committed journal identity, never a new question.
				return id;
			},
		);
		const initialMessageCount = session.messages.length;
		const pendingSteering = new Map<
			number,
			{ text: string; resolve(): void; reject(error: Error): void }
		>();
		const previousUsage = session.messages
			.filter((message) => message.role === "assistant")
			.reduce((sum, message) => sum + message.usage.totalTokens, 0);
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "user") {
				const content =
					typeof event.message.content === "string"
						? event.message.content
						: event.message.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join("\n");
				for (const [id, pending] of pendingSteering)
					if (content === pending.text) {
						pendingSteering.delete(id);
						pending.resolve();
					}
			}
			// The shared UI is driven by the durable task journal, so record compact
			// assistant events as they arrive instead of leaving the conversation blank
			// until agent_end publishes its final messages.
			if (
				(event.type === "message_start" && event.message.role === "assistant") ||
				event.type === "message_update" ||
				(event.type === "message_end" && event.message.role === "assistant")
			)
				context.publish({
					type: "agent_event",
					turnId: context.turnId,
					event: serializeAgentEvent(event),
				});
			if (
				event.type === "tool_execution_start" ||
				event.type === "tool_execution_update" ||
				event.type === "tool_execution_end"
			)
				context.publish({
					type: "tool_progress",
					phase:
						event.type === "tool_execution_start" ? "started" : event.type === "tool_execution_update" ? "updated" : "completed",
					turnId: context.turnId,
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					event: serializeAgentEvent(event),
					...(event.type === "tool_execution_end" ? { isError: event.isError } : {}),
				});
			if (event.type === "agent_end")
				context.publish({
					type: "messages",
					turnId: context.turnId,
					messages: session!.messages.slice(initialMessageCount),
				});
		});
		const abort = () => {
			void session!.abort();
		};
		context.signal.addEventListener("abort", abort, { once: true });
		return {
			run: async () => {
				if (context.signal.aborted)
					throw new Error("Task was cancelled before model dispatch");
				const continuation = context.continuation as { payload?: { kind?: string; question: string; options: PickOption[] }; answer: string | null } | null;
				const answered = continuation?.payload?.kind === "pick_option"
					? { ...continuation, result: resolvePickOptionAnswer(continuation.payload.question, continuation.payload.options, continuation.answer) }
					: continuation;
				const prompt = context.continuation
					? `Continue in a fresh turn after ${"documentAction" in Object(context.continuation) ? "the verified document action, using the new captured binding" : "the user's answer"}.\n${JSON.stringify(answered)}`
					: skills.expandCommand(context.text);
				await session!.agent.prompt(
					prompt,
					context.attachments as ImageAttachment[],
				);
				const usage = session!.messages
					.filter((message) => message.role === "assistant")
					.reduce((sum, message) => sum + message.usage.totalTokens, 0);
				const used = Math.max(0, usage - previousUsage);
				const last = session!.messages
					.slice(initialMessageCount)
					.filter((message) => message.role === "assistant")
					.at(-1);
				if (
					last &&
					(last.stopReason === "error" || last.stopReason === "aborted")
				) {
					const error = new Error(
						last.errorMessage ?? `Model response ${last.stopReason}`,
					) as Error & { usage: number };
					error.usage = used;
					throw error;
				}
				return { usage: used };
			},
			steer: async (payload, inputId = 0) => {
				const input = payload as {
					text: string;
					attachments?: ImageAttachment[];
				};
				const text = `[Steering input ${inputId}]\n${skills.expandCommand(input.text)}`;
				const consumed = new Promise<void>((resolve, reject) =>
					pendingSteering.set(inputId, { text, resolve, reject }),
				);
				void consumed.catch(() => {});
				try {
					await session!.steer(text, input.attachments);
				} catch (error) {
					pendingSteering.delete(inputId);
					throw error;
				}
				await consumed;
			},
			cancel: () => session!.abort(),
			cleanup: async () => {
				if (cleanupResult) return cleanupResult;
				await session!.waitForIdle();
				session!.agent.clearAllQueues();
				for (const pending of pendingSteering.values()) {
					const error = new Error(
						"Steering was not consumed before this turn ended",
					);
					error.name = "SteeringNotAppliedError";
					pending.reject(error);
				}
				pendingSteering.clear();
				boundary!.dispose();
				try {
					cleanupResult = geometry
						? await geometry.cleanup()
						: {
								confirmed: true,
								evidence: { kind: "discussion", nativeOperations: 0 },
							};
					return cleanupResult;
				} finally {
					context.signal.removeEventListener("abort", abort);
					unsubscribe();
					session!.dispose();
				}
			},
		};
	} catch (error) {
		boundary?.dispose();
		session?.dispose();
		let cleanupConfirmed = !geometry;
		try {
			if (geometry) cleanupConfirmed = (await geometry.cleanup()).confirmed;
		} catch {
			cleanupConfirmed = false;
		}
		throw Object.assign(
			error instanceof Error ? error : new Error(String(error)),
			{ cleanupConfirmed },
		);
	}
}
