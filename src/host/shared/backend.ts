import type { HostRuntime } from "../pi-runtime.js";
import type { SharedBrowserBackend } from "./browser-server.js";
import {
	parseSharedBrowserCommand,
	type SharedBrowserCommand,
} from "./browser-protocol.js";
import { SharedTaskService } from "./task-service.js";
import { SharedRegistry, TargetUnavailableError } from "./registry.js";

/** Authenticated browser commands enter here; no model or native work starts before journal commit. */
export class SharedBackend implements SharedBrowserBackend {
	private readonly listeners = new Set<(event: unknown) => void>();
	private readonly unsubscribe: (() => void)[];
	private stopping = false;
	private readonly admissions = new Map<string, Promise<unknown>>();
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
			authorizeDocument(
				taskId: string,
				command: Extract<SharedBrowserCommand, { type: "submit" }>,
			): Promise<void>;
			authorizeLaunch(
				taskId: string,
				command: Extract<SharedBrowserCommand, { type: "submit" }>,
			): Promise<void>;
			installations(): unknown[];
			recoverLaunch?(
				requestId: string,
				taskId: string,
				launchRequestId: string,
				acknowledgement: string,
			): Promise<unknown>;
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
		const journal = this.tasks.snapshot();
		return {
			...journal,
			hostEpoch: this.hostEpoch,
			targets: this.registry.list(),
			installations: this.actions?.installations() ?? [],
			runtime: this.admin.snapshot(),
			eventCursor: Number(journal.events.at(-1)?.id ?? 0),
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
		this.emit({ type: "shared_snapshot", snapshot: this.snapshot() });
	}
	private taskInConversation(taskId: string, conversationId: string): void {
		if (
			!this.tasks
				.snapshot()
				.tasks.some(
					(task) =>
						task.id === taskId && task.conversation_id === conversationId,
				)
		)
			throw new Error("Task is not in this conversation");
	}
	private async configure<T>(work: () => Promise<T>): Promise<T> {
		const pending = this.settings.then(work, work);
		this.settings = pending.catch(() => {});
		return pending;
	}
	async drainAdmissions(): Promise<void> {
		await Promise.allSettled([...this.admissions.values()]);
	}
	async resumeAdmissions(): Promise<void> {
		if (this.stopping) return;
		const snapshot = this.tasks.snapshot();
		for (const record of snapshot.records.filter(
			(record) => record.kind === "admission" && record.state === "pending",
		)) {
			const task = snapshot.tasks.find(
				(task) =>
					task.id === record.task_id &&
					task.state === "queued" &&
					!task.cancellation_requested,
			);
			if (!task) continue;
			let command: SharedBrowserCommand;
			try {
				command = parseSharedBrowserCommand(
					JSON.stringify({
						...JSON.parse(String(task.payload)),
						type: "submit",
					}),
				);
				if (command.type !== "submit") continue;
				for (const binding of command.bindings)
					this.registry.resolveBinding(binding);
				if (command.documentAction)
					this.registry.resolveLifecycle(
						command.documentAction.lifecycleInstanceId,
					);
			} catch (error) {
				if (error instanceof TargetUnavailableError && error.permanent) {
					this.tasks.journal.finishAdmission(String(task.id), error.message);
					this.publish();
				}
				continue;
			}
			await this.command(command);
		}
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
				this.publish();
				this.admin.ui.replayPending();
				return null;
			case "create_conversation": {
				const receipt = this.tasks.journal.createConversation(
					command.requestId,
					command.title,
				);
				this.publish();
				return receipt;
			}
			case "submit": {
				const input = {
					requestId: command.requestId,
					conversationId: command.conversationId,
					sessionId: command.sessionId,
					kind: command.kind,
					text: command.text,
					bindings: command.bindings,
					attachments: command.attachments,
					...(command.documentAction
						? { documentAction: command.documentAction }
						: {}),
					...(command.launch ? { launch: command.launch } : {}),
				};
				const prior = this.tasks.journal.findRequest(command.requestId, input);
				if (
					prior &&
					this.tasks
						.snapshot()
						.records.find(
							(record) =>
								record.kind === "admission" &&
								record.id === (prior as { taskId: string }).taskId,
						)?.state !== "pending"
				)
					return prior;
				const ongoing = this.admissions.get(command.requestId);
				if (ongoing) return ongoing;
				if (!prior)
					for (const binding of command.bindings)
						this.registry.resolveBinding(binding);
				const receipt = this.tasks.journal.accept(input);
				const admission = (async () => {
					try {
						if (command.documentAction) {
							if (!this.actions)
								throw new Error("Document actions are unavailable");
							await this.actions.authorizeDocument(receipt.taskId, command);
						}
						if (command.launch) {
							if (!this.actions) throw new Error("Rhino launch is unavailable");
							await this.actions.authorizeLaunch(receipt.taskId, command);
						}
						this.tasks.journal.finishAdmission(receipt.taskId);
					} catch (error) {
						if (
							this.tasks
								.snapshot()
								.tasks.find((task) => task.id === receipt.taskId)?.state ===
							"queued"
						)
							this.tasks.journal.finishAdmission(receipt.taskId, String(error));
						this.publish();
						return {
							...receipt,
							admissionError:
								error instanceof Error ? error.message : String(error),
						};
					}
					this.publish();
					this.tasks.pump();
					return receipt;
				})();
				this.admissions.set(command.requestId, admission);
				try {
					return await admission;
				} finally {
					this.admissions.delete(command.requestId);
				}
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
				const question = this.tasks
					.snapshot()
					.questions.find((question) => question.id === command.questionId);
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
			case "recover_launch": {
				this.taskInConversation(command.taskId, command.conversationId);
				const snapshot = this.tasks.snapshot();
				const task = snapshot.tasks.find((row) => row.id === command.taskId);
				const launch = snapshot.records.find(
					(row) =>
						row.kind === "launch" &&
						row.id === command.launchRequestId &&
						row.task_id === command.taskId,
				);
				if (task?.parent_task_id || !launch)
					throw new Error("Launch does not belong to this root task");
				if (!this.actions?.recoverLaunch)
					throw new Error("Launch recovery is unavailable");
				const result = await this.actions.recoverLaunch(
					command.requestId,
					command.taskId,
					command.launchRequestId,
					command.acknowledgement,
				);
				this.publish();
				return result;
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
		for (const unsubscribe of this.unsubscribe) unsubscribe();
		this.listeners.clear();
	}
}
