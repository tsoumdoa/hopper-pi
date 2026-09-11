import type { HostRuntime } from "../pi-runtime.js";
import type { SharedBrowserBackend } from "./browser-server.js";
import type { SharedBrowserCommand } from "./browser-protocol.js";
import { SharedTaskService } from "./task-service.js";
import { SharedRegistry } from "./registry.js";

/** Authenticated browser commands enter here; no model or native work starts before journal commit. */
export class SharedBackend implements SharedBrowserBackend {
	private readonly listeners = new Set<(event: unknown) => void>();
	private readonly unsubscribe: (() => void)[];
	private stopping = false;
	private view: { conversationId?: string; before?: number } = {};
	private historyKey = "";
	private publishedHistoryKey = "";
	private history?: ReturnType<SharedTaskService["journal"]["browserSnapshot"]>;
	private publishTimer?: ReturnType<typeof setTimeout>;
	stopAdmission(): void {
		this.stopping = true;
	}
	private settings: Promise<unknown> = Promise.resolve();
	constructor(
		readonly tasks: SharedTaskService,
		readonly registry: SharedRegistry,
		private readonly admin: HostRuntime,
		private readonly stopHost: () => Promise<void>,
		private readonly actions?: {
			recover(
				requestId: string,
				taskId: string,
				acknowledgement: string,
			): Promise<unknown>;
		},
		private readonly hostEpoch = "test-host",
	) {
		this.unsubscribe = [
			tasks.subscribe(() => this.publish()),
			admin.bus.subscribe((event) => {
				if (event.type === "snapshot" || event.type === "session_replaced")
					this.publish();
				else if (
					event.type === "tool_settings" ||
					event.type === "ui_request" ||
					event.type === "auth_event" ||
					event.type === "error" ||
					event.type === "ui_notification"
				)
					this.emit(event);
			}),
		];
	}
	snapshot() {
		const cursor = this.tasks.journal.eventCursor;
		const session = this.registry.conversationSession;
		const key = JSON.stringify([cursor, this.tasks.journal.conversationRevision, this.tasks.journal.lastConversationSequence, session, this.view]);
		if (key !== this.historyKey || !this.history) {
			this.history = this.tasks.journal.browserSnapshot({ ...this.view, afterConversationSequence: session.afterConversationSequence });
			this.historyKey = key;
		}
		return {
			...this.history,
			historyStorage: this.tasks.journal.historyStorage,
			hostEpoch: this.hostEpoch,
			conversationSession: this.registry.conversationSession,
			targets: this.registry.list(),
			runtime: this.admin.snapshot(),
			eventCursor: cursor,
		};
	}
	exportConversation(conversationId: string | null) {
		const snapshot = this.tasks.journal.conversationSnapshot(conversationId);
		const conversation = snapshot.conversations.find((row) => row.id === conversationId);
		if (!conversation) throw new Error("Select a conversation to export");
		const tasks = snapshot.tasks.filter((row) => row.conversation_id === conversationId);
		const taskIds = new Set(tasks.map((row) => row.id));
		const belongs = (row: Record<string, unknown>) => taskIds.has(String(row.task_id));
		return {
			format: "hopper-conversation-debug",
			version: 1,
			exportedAt: new Date().toISOString(),
			conversation,
			sessions: snapshot.sessions.filter((row) => row.conversation_id === conversationId),
			tasks,
			turns: snapshot.turns.filter(belongs),
			inputs: snapshot.inputs.filter(belongs),
			questions: snapshot.questions.filter(belongs),
			events: snapshot.events.filter(belongs),
			operations: snapshot.operations.filter(belongs),
			recoveries: snapshot.recoveries.filter(belongs),
			records: snapshot.records.filter(belongs),
			dependencies: snapshot.dependencies.filter(belongs),
		};
	}
	subscribe(listener: (event: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private emit(event: unknown): void {
		for (const listener of this.listeners) listener(event);
	}
	publish(): void {
		// Token deltas can arrive much faster than a browser can consume full history.
		// Persist every event, but build and send at most one current snapshot per interval.
		if (!this.listeners.size || this.publishTimer) return;
		this.publishTimer = setTimeout(() => {
			this.publishTimer = undefined;
			if (this.listeners.size) {
				const snapshot = this.snapshot();
				if (this.publishedHistoryKey !== this.historyKey) {
					this.publishedHistoryKey = this.historyKey;
					this.emit({ type: "shared_snapshot", snapshot });
				} else {
					const { runtime, targets, hostEpoch, conversationSession } = snapshot;
					this.emit({ type: "shared_status", runtime, targets, hostEpoch, conversationSession });
				}
			}
		}, 50);
		this.publishTimer.unref();
	}
	private taskInConversation(taskId: string, conversationId: string): void {
		if (this.tasks.journal.getTask(taskId)?.conversation_id !== conversationId)
			throw new Error("Task is not in this conversation");
	}
	private async configure<T>(work: () => Promise<T>): Promise<T> {
		const pending = this.settings.then(work, work);
		this.settings = pending.catch(() => {});
		return pending;
	}
	async command(
		command: Exclude<SharedBrowserCommand, { type: "authenticate" }>,
	): Promise<unknown> {
		if (
			this.stopping &&
			command.type !== "snapshot" &&
			command.type !== "auth_response"
		)
			throw new Error("Host is stopping; new commands are not accepted");
		switch (command.type) {
			case "snapshot":
				if (command.conversationId) this.view = { conversationId: command.conversationId, before: command.before };
				this.publish();
				this.admin.ui.replayPending();
				return null;
			case "create_conversation": {
				const receipt = this.tasks.journal.createConversation(
					command.requestId,
					command.title,
				);
				this.view = { conversationId: receipt.conversationId };
				this.publish();
				return receipt;
			}
			case "purge_archived_conversations": {
				try { return this.tasks.journal.purgeArchivedConversations(command.requestId, command.conversationIds, command.before); }
				finally { this.historyKey = ""; this.publish(); }
			}
			case "archive_conversation":
			case "unarchive_conversation":
			case "delete_conversation": {
				try {
					return this.tasks.journal.manageConversation(command.requestId, command.conversationId, command.type);
				} finally { this.historyKey = ""; this.publish(); }
			}
			case "submit": {
				const input = {
					requestId: command.requestId,
					conversationId: command.conversationId,
					sessionId: command.sessionId,
					kind: command.kind,
					text: command.text,
					bindings: command.bindings,
					...(command.messageTarget ? { messageTarget: command.messageTarget } : {}),
					attachments: command.attachments,
				};
				const prior = this.tasks.journal.findRequest(command.requestId, input);
				if (prior) return prior;
				for (const binding of command.bindings) this.registry.resolveBinding(binding);
				const receipt = this.tasks.submit(input);
				this.publish();
				return receipt;
			}
			case "steer":
				this.taskInConversation(command.taskId, command.conversationId);
				return this.tasks.steer(
					command.requestId,
					command.taskId,
					command.sessionId,
					command.turnId,
					{ text: command.text, attachments: command.attachments },
				);
			case "answer": {
				const question = this.tasks.journal.getQuestion(command.questionId);
				if (!question) throw new Error("Question no longer exists");
				this.taskInConversation(
					String(question.task_id),
					command.conversationId,
				);
				return this.tasks.answer(
					command.requestId,
					command.questionId,
					command.answer,
				);
			}
			case "recover":
				this.taskInConversation(command.taskId, command.conversationId);
				if (!this.actions) throw new Error("Recovery is unavailable");
				const result = await this.actions.recover(
					command.requestId,
					command.taskId,
					command.acknowledgement,
				);
				this.publish();
				return result;
			case "cancel":
				this.taskInConversation(command.taskId, command.conversationId);
				await this.tasks.cancel(command.taskId, command.requestId);
				return { taskId: command.taskId };
			case "stop_host":
				if (command.hostEpoch !== this.hostEpoch)
					throw new Error(
						"Host restarted; review its current state before stopping it",
					);
				this.stopping = true;
				try {
					await this.stopHost();
				} catch (error) {
					this.stopping = false;
					throw error;
				}
				return { stopped: true };
			case "set_model":
				await this.configure(() =>
					this.admin.setModel(command.provider, command.modelId),
				);
				this.publish();
				return null;
			case "set_thinking":
				await this.configure(async () => this.admin.setThinkingLevel(command.level));
				this.publish();
				return null;
			case "logout":
				await this.configure(() => this.admin.logout(command.provider));
				this.publish();
				return null;
			case "login":
				await this.configure(() =>
					this.admin.login(command.provider, command.authType, command.apiKey),
				);
				this.publish();
				return null;
			case "auth_response":
				if (!this.admin.ui.respond(command.requestId, command.value))
					throw new Error("Authentication prompt is no longer pending");
				return null;
		}
	}
	dispose(): void {
		clearTimeout(this.publishTimer);
		for (const unsubscribe of this.unsubscribe) unsubscribe();
		this.listeners.clear();
		this.history = undefined;
	}
}
