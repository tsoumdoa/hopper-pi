import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import {
	TaskJournal,
	type Submission,
	type Receipt,
	type Row,
} from "./journal.js";
import { TargetUnavailableError } from "./registry.js";

export interface DriverContext {
	taskId: string;
	turnId: string;
	sessionId: string;
	conversationId: string;
	parentTaskId?: string | null;
	binding: TargetBinding | null;
	messageTarget?: TargetBinding;
	accessibleBindings?: readonly TargetBinding[];
	owner: ExecutionOwner | null;
	text: string;
	attachments: readonly unknown[];
	continuation: unknown;
	signal: AbortSignal;
	ask(toolCallId: string, payload: unknown): string;
	requestDocumentAction(grantId: string): string;
	publish(payload: unknown): void;
}
export interface TaskDriver {
	run(): Promise<{ usage?: number } | void>;
	steer(payload: unknown, inputId?: number): Promise<void>;
	cancel(): void | Promise<void>;
	cleanup(): Promise<{ confirmed: boolean; evidence?: unknown }>;
	pauseGeometry?(): Promise<{ confirmed: boolean; evidence?: unknown }>;
	resumeGeometry?(): Promise<void>;
}
export interface TaskServiceOptions {
	createDriver(context: DriverContext): TaskDriver | Promise<TaskDriver>;
	resolveBinding(binding: TargetBinding): {
		processKey: string;
		attachmentGeneration: string;
	};
	validateBinding(owner: ExecutionOwner): void | Promise<void>;
	resolveLifecycle?(lifecycleId: string): {
		processKey: string;
		attachmentGeneration: string;
	};
	maxWorkers?: number;
	maxCoordinators?: number;
	maxUsage?: number;
}
interface Active {
	controller: AbortController;
	driver?: TaskDriver;
	processKey?: string;
	turnId: string;
}
/** Owns model lifetimes independently of browser connections. */
export class SharedTaskService {
	private readonly active = new Map<string, Active>();
	private readonly held = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private pumping = false;
	private stopped = false;
	private readonly executions = new Set<Promise<void>>();
	private documentActionExecutor?: (
		grantId: string,
	) => Promise<{ binding: TargetBinding; result: unknown; actionId: string }>;
	setDocumentActionExecutor(
		executor: (
			grantId: string,
		) => Promise<{ binding: TargetBinding; result: unknown; actionId: string }>,
	): void {
		this.documentActionExecutor = executor;
	}
	constructor(
		readonly journal: TaskJournal,
		private readonly options: TaskServiceOptions,
	) {
		if (
			options.maxWorkers !== undefined &&
			(!Number.isInteger(options.maxWorkers) || options.maxWorkers < 1)
		)
			throw new Error("Invalid worker limit");
		if (
			options.maxCoordinators !== undefined &&
			(!Number.isInteger(options.maxCoordinators) ||
				options.maxCoordinators < 1)
		)
			throw new Error("Invalid coordinator limit");
		if (
			options.maxUsage !== undefined &&
			(!Number.isFinite(options.maxUsage) || options.maxUsage < 0)
		)
			throw new Error("Invalid usage budget");
		// Restore both edit-turn and ownerless coordinator action leases after recovery.
		const snapshot = journal.snapshot(),
			unresolved = new Set(
				snapshot.tasks
					.filter(
						(task) =>
							["running", "suspending", "uncertain"].includes(
								String(task.state),
							) &&
							!snapshot.recoveries.some((record) => record.task_id === task.id),
					)
					.map((task) => task.id),
			);
		for (const record of [...snapshot.turns, ...snapshot.operations])
			if (unresolved.has(record.task_id) && record.owner) {
				const processKey = this.processOfOwner(
					JSON.parse(String(record.owner)),
				);
				if (processKey) this.held.set(processKey, String(record.task_id));
			}
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* Observers cannot roll back committed work. */
			}
		}
	}
	snapshot() {
		return this.journal.snapshot();
	}
	submit(input: Submission): Receipt {
		if (this.stopped) throw new Error("Host is stopping");
		const receipt = this.journal.accept(input);
		this.changed();
		this.pump();
		return receipt;
	}
	delegate(
		input: Submission & { parentTaskId: string; dependencies: string[] },
	): Receipt {
		if (this.stopped) throw new Error("Host is stopping");
		if (this.usage() >= (this.options.maxUsage ?? Infinity))
			throw new Error("Model usage budget exhausted");
		const receipt = this.journal.delegate(input);
		this.changed();
		this.pump();
		return receipt;
	}
	answer(requestId: string, questionId: string, answer: unknown): Receipt {
		const receipt = this.journal.answer(requestId, questionId, answer);
		this.changed();
		this.pump();
		return receipt;
	}
	steer(
		requestId: string,
		taskId: string,
		sessionId: string,
		turnId: string,
		payload: unknown,
	): { inputId: number } {
		const receipt = this.journal.steer(
			requestId,
			taskId,
			sessionId,
			turnId,
			payload,
		);
		this.changed();
		void this.deliver(taskId, receipt.inputId, payload);
		return receipt;
	}
	private readonly delivery = new Map<string, Promise<void>>();
	private async deliver(
		taskId: string,
		inputId: number,
		payload: unknown,
	): Promise<void> {
		const previous = this.delivery.get(taskId) ?? Promise.resolve();
		const pending = previous.then(async () => {
			const state = this.journal
				.snapshot()
				.inputs.find((row) => row.id === inputId)?.state;
			if (state !== "accepted") return;
			const active = this.active.get(taskId);
			if (!active?.driver || active.controller.signal.aborted) return;
			try {
				this.journal.markInput(inputId, "delivering");
				await active.driver.steer(payload, inputId);
				this.journal.markInput(inputId, "applied");
			} catch (error) {
				if (error instanceof Error && error.name === "SteeringNotAppliedError")
					this.journal.markInputNotApplied(
						inputId,
					); /* Other delivery errors remain unknown and are never replayed. */
			}
			this.changed();
		});
		this.delivery.set(taskId, pending);
		await pending;
		if (this.delivery.get(taskId) === pending) this.delivery.delete(taskId);
	}
	async cancel(taskId: string, requestId?: string): Promise<void> {
		const ids = this.journal.requestCancellation(taskId, requestId);
		for (const id of ids) {
			const active = this.active.get(id);
			if (active) {
				active.controller.abort();
				try {
					await active.driver?.cancel();
				} catch {
					/* cleanup decides certainty */
				}
			} else {
				const snapshot = this.journal.snapshot(),
					task = snapshot.tasks.find((t) => t.id === id);
				const turn = snapshot.turns.filter((t) => t.task_id === id).at(-1);
				if (turn && ["queued", "awaiting_user"].includes(String(task?.state)))
					this.journal.settle(id, String(turn.id), "cancelled");
			}
		}
		this.changed();
		this.pump();
	}
	async stop(): Promise<void> {
		this.stopped = true;
		for (const task of this.snapshot().tasks)
			if (
				["queued", "running", "suspending", "awaiting_user"].includes(
					String(task.state),
				)
			)
				await this.cancel(String(task.id));
		await Promise.allSettled([...this.executions]);
	}
	releaseRecovered(taskId: string): void {
		if (!this.snapshot().recoveries.some((row) => row.task_id === taskId))
			throw new Error("No durable recovery disposition");
		for (const [key, id] of this.held) if (id === taskId) this.held.delete(key);
		this.changed();
		this.pump();
	}
	private readonly childWaits = new Map<string, Promise<{ tasks: Row[]; usage: number }>>();
	async waitForChildren(taskId: string): Promise<{ tasks: Row[]; usage: number }> {
		const existing = this.childWaits.get(taskId);
		if (existing) return existing;
		const pending = this.waitForChildrenOnce(taskId);
		this.childWaits.set(taskId, pending);
		try { return await pending; }
		finally { this.childWaits.delete(taskId); }
	}
	private async waitForChildrenOnce(taskId: string): Promise<{ tasks: Row[]; usage: number }> {
		const active = this.active.get(taskId);
		if (!active || this.snapshot().tasks.find((task) => task.id === taskId)?.parent_task_id !== null)
			throw new Error("Only an active root task can wait for children");
		const settled = (task: Row) => ["completed", "failed", "cancelled", "interrupted", "uncertain"].includes(String(task.state));
		const pending = this.snapshot().tasks.some((task) => task.parent_task_id === taskId && !settled(task));
		const owner = JSON.parse(String(this.snapshot().turns.find((turn) => turn.id === active.turnId)?.owner ?? "null")) as ExecutionOwner | null;
		let paused = false;
		if (pending && active.processKey) {
			if (!active.driver?.pauseGeometry || !active.driver.resumeGeometry || !owner)
				throw new Error("This task cannot release its document while waiting for children");
			const cleanup = await active.driver.pauseGeometry();
			if (!cleanup.confirmed || this.unresolvedProcess(active.processKey))
				throw new Error("Native edit cleanup must be confirmed before delegated work can start");
			if (this.held.get(active.processKey) === taskId) this.held.delete(active.processKey);
			active.processKey = undefined;
			paused = true;
			this.changed();
			this.pump();
		}
		try {
			while (true) {
				if (active.controller.signal.aborted) throw new Error("Task cancelled");
				const snapshot = this.snapshot();
				const tasks = snapshot.tasks.filter((task) => task.parent_task_id === taskId);
				if (tasks.every(settled)) {
					const ids = new Set(tasks.map((task) => task.id));
					return { tasks, usage: snapshot.turns.filter((turn) => ids.has(turn.task_id)).reduce((sum, turn) => sum + Number(turn.usage), 0) };
				}
				await this.waitForChange(active);
			}
		} finally {
			if (paused && !active.controller.signal.aborted) {
				// Reacquire the same document and generation before the main agent
				// continues. Another document in the process may have been activated.
				while (true) {
					if (active.controller.signal.aborted) throw new Error("Task cancelled");
					let target;
					try { target = this.options.resolveBinding(owner!.binding); }
					catch (error) {
						if (!(error instanceof TargetUnavailableError) || error.permanent) throw error;
						await this.waitForChange(active);
						continue;
					}
					if (target.attachmentGeneration !== owner!.attachmentGeneration)
						throw new Error("Selected document attachment changed while waiting for children");
					const workers = [...this.active.values()].filter((task) => task.processKey !== undefined).length;
					if (!this.held.has(target.processKey) && !this.unresolvedProcess(target.processKey) && workers < (this.options.maxWorkers ?? 4)) {
						this.held.set(target.processKey, taskId);
						active.processKey = target.processKey;
						await this.options.validateBinding(owner!);
						await active.driver!.resumeGeometry!();
						this.changed();
						break;
					}
					await this.waitForChange(active);
				}
			}
		}
	}
	private waitForChange(active: Active): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				unsubscribe();
				active.controller.signal.removeEventListener("abort", done);
				resolve();
			};
			const unsubscribe = this.subscribe(done);
			active.controller.signal.addEventListener("abort", done, { once: true });
			if (active.controller.signal.aborted) done();
		});
	}

	/** Coordinator-managed actions acquire the same queue used by worker scopes. */
	async withProcess<T>(
		taskId: string,
		binding: TargetBinding,
		work: (owner: ExecutionOwner) => Promise<T>,
	): Promise<T> {
		const active = this.active.get(taskId);
		if (!active || active.controller.signal.aborted)
			throw new Error("Managed action requires an active task");
		if (active.processKey || [...this.held.values()].includes(taskId))
			throw new Error(
				"Direct edit scope must finish a durable handoff before a document or transfer action",
			);
		const input = JSON.parse(
			String(this.snapshot().tasks.find((t) => t.id === taskId)!.payload),
		) as Submission;
		const normalized = (b: TargetBinding) =>
			b.kind === "rhino"
				? [b.kind, b.lifecycleInstanceId, b.rhinoDocumentId].join("|")
				: [
						b.kind,
						b.lifecycleInstanceId,
						b.grasshopperDocumentId,
						b.associatedRhinoDocumentId,
					].join("|");
		if (
			![...input.bindings, ...this.journal.authorizationAdditions(taskId)].some(
				(b) => normalized(b) === normalized(binding),
			)
		)
			throw new Error("Managed action target is not authorized");
		while (true) {
			if (active.controller.signal.aborted || !this.active.has(taskId))
				throw new Error("Task cancelled or ended");
			const target = this.options.resolveBinding(binding);
			if (
				!this.held.has(target.processKey) &&
				!this.unresolvedProcess(target.processKey)
			) {
				this.held.set(target.processKey, taskId);
				const owner: ExecutionOwner = Object.freeze({
					taskId,
					turnId: active.turnId,
					binding: Object.freeze({ ...binding }),
					attachmentGeneration: target.attachmentGeneration,
				});
				try {
					await this.options.validateBinding(owner);
					return await work(owner);
				} finally {
					const unresolved = this.snapshot().operations.some(
						(op) =>
							op.task_id === taskId &&
							["dispatched", "uncertain"].includes(String(op.state)) &&
							op.owner &&
							JSON.parse(String(op.owner))?.binding?.lifecycleInstanceId ===
								binding.lifecycleInstanceId,
					);
					const scopeUnknown = this.snapshot().records.some(
						(record) =>
							record.kind === "scope" &&
							record.task_id === taskId &&
							record.state === "uncertain",
					);
					if (!unresolved && !scopeUnknown) this.held.delete(target.processKey);
					this.changed();
					this.pump();
				}
			}
			if (this.held.get(target.processKey) === taskId)
				throw new Error("Managed actions cannot nest ownership in one process");
			await new Promise<void>((resolve) => {
				const done = () => {
					unsubscribe();
					active.controller.signal.removeEventListener("abort", done);
					resolve();
				};
				const unsubscribe = this.subscribe(done);
				active.controller.signal.addEventListener("abort", done, {
					once: true,
				});
			});
		}
	}

	async withLifecycle<T>(
		taskId: string,
		lifecycleId: string,
		work: (target: {
			turnId: string;
			attachmentGeneration: string;
		}) => Promise<T>,
	): Promise<T> {
		const active = this.active.get(taskId);
		if (
			!active ||
			active.controller.signal.aborted ||
			!this.options.resolveLifecycle
		)
			throw new Error("Lifecycle action is unavailable");
		if (active.processKey || [...this.held.values()].includes(taskId))
			throw new Error("Finish direct scope handoff before a lifecycle action");
		while (true) {
			if (active.controller.signal.aborted || !this.active.has(taskId))
				throw new Error("Task cancelled or ended");
			const target = this.options.resolveLifecycle(lifecycleId);
			if (
				!this.held.has(target.processKey) &&
				!this.unresolvedProcess(target.processKey)
			) {
				this.held.set(target.processKey, taskId);
				try {
					return await work({
						turnId: active.turnId,
						attachmentGeneration: target.attachmentGeneration,
					});
				} finally {
					const unresolved = this.snapshot().operations.some(
						(op) =>
							op.task_id === taskId &&
							["dispatched", "uncertain"].includes(String(op.state)) &&
							op.owner &&
							JSON.parse(String(op.owner))?.lifecycleInstanceId === lifecycleId,
					);
					const scopeUnknown = this.snapshot().records.some(
						(record) =>
							record.kind === "scope" &&
							record.task_id === taskId &&
							record.state === "uncertain",
					);
					if (!unresolved && !scopeUnknown) this.held.delete(target.processKey);
					this.changed();
					this.pump();
				}
			}
			await new Promise<void>((resolve) => {
				const done = () => {
					unsubscribe();
					active.controller.signal.removeEventListener("abort", done);
					resolve();
				};
				const unsubscribe = this.subscribe(done);
				active.controller.signal.addEventListener("abort", done, {
					once: true,
				});
			});
		}
	}

	private processOfOwner(owner: any): string | undefined {
		if (!owner) return;
		const lifecycleId =
			owner.binding?.lifecycleInstanceId ?? owner.lifecycleInstanceId;
		try {
			if (owner.binding)
				return this.options.resolveBinding(owner.binding).processKey;
			const target = this.options.resolveLifecycle?.(lifecycleId);
			if (target) return target.processKey;
		} catch {
			/* Registry can retain a detached process identity below. */
		}
		const attachment = this.snapshot().attachments.find(
			(row) => row.lifecycle_id === lifecycleId,
		);
		if (attachment) {
			const value = JSON.parse(String(attachment.payload));
			return `${value.processId}:${value.processStartTime}`;
		}
	}
	private unresolvedProcess(processKey: string): string | undefined {
		const snapshot = this.snapshot(),
			unresolved = new Set(
				snapshot.tasks
					.filter(
						(task) =>
							task.state === "uncertain" &&
							!snapshot.recoveries.some((record) => record.task_id === task.id),
					)
					.map((task) => task.id),
			);
		const record = [...snapshot.turns, ...snapshot.operations].find(
			(record) =>
				unresolved.has(record.task_id) &&
				record.owner &&
				this.processOfOwner(JSON.parse(String(record.owner))) === processKey,
		);
		return record ? String(record.task_id) : undefined;
	}

	private usage(): number {
		return this.journal
			.snapshot()
			.turns.reduce((total, row) => total + Number(row.usage), 0);
	}
	pump(): void {
		if (this.pumping || this.stopped) return;
		this.pumping = true;
		try {
			const snapshot = this.journal.snapshot();
			for (const task of snapshot.tasks) {
				if (
					task.state !== "queued" ||
					task.cancellation_requested ||
					this.active.has(String(task.id))
				)
					continue;
				if (
					snapshot.records.some(
						(record) =>
							record.kind === "admission" &&
							record.task_id === task.id &&
							record.state !== "ready",
					)
				)
					continue;
				const turn = snapshot.turns.find(
					(t) => t.task_id === task.id && t.state === "queued",
				);
				if (!turn) continue;
				if (this.usage() >= (this.options.maxUsage ?? Infinity)) {
					this.journal.failQueued(
						String(task.id),
						String(turn.id),
						"Model usage budget exhausted",
					);
					this.changed();
					continue;
				}
				const failedDependency = snapshot.dependencies.some(
					(d) =>
						d.task_id === task.id &&
						snapshot.tasks.some(
							(dependency) =>
								dependency.id === d.dependency_id &&
								["failed", "cancelled", "interrupted", "uncertain"].includes(
									String(dependency.state),
								),
						),
				);
				if (failedDependency) {
					this.journal.failQueued(
						String(task.id),
						String(turn.id),
						"Dependency did not complete successfully",
					);
					this.changed();
					continue;
				}
				const input = JSON.parse(String(task.payload)) as Submission;
				// Access to other documents never removes the selected document owner.
				const handoff = snapshot.records.find(
					(r) =>
						r.kind === "handoff" &&
						r.state === "completed" &&
						JSON.parse(String(r.payload)).continuationId === turn.id,
				);
				const binding = handoff
					? (JSON.parse(String(handoff.payload)).binding as TargetBinding)
					: input.messageTarget ?? (input.bindings.length === 1 ? input.bindings[0]! : null);
				if (
					!binding &&
					[...this.active.values()].filter(
						(active) => active.processKey === undefined,
					).length >= (this.options.maxCoordinators ?? 4)
				)
					continue;
				let processKey: string | undefined,
					owner: ExecutionOwner | null = null;
				if (binding) {
					if (
						[...this.active.values()].filter(
							(active) => active.processKey !== undefined,
						).length >= (this.options.maxWorkers ?? 4)
					)
						continue;
					try {
						const target = this.options.resolveBinding(binding);
						processKey = target.processKey;
						const blockingTaskId = this.unresolvedProcess(processKey) ?? this.held.get(processKey);
						if (blockingTaskId) {
							const needsRecovery = snapshot.tasks.some((task) => task.id === blockingTaskId && task.state === "uncertain");
							this.journal.setSchedulingBlock(String(task.id), needsRecovery
								? "Waiting for recovery of an earlier task in this Rhino instance."
								: "Waiting for an earlier task in this Rhino instance to finish.", blockingTaskId);
							this.changed();
							continue;
						}
						owner = Object.freeze({
							taskId: String(task.id),
							turnId: String(turn.id),
							binding: Object.freeze({ ...binding }),
							attachmentGeneration: target.attachmentGeneration,
						});
					} catch (error) {
						if (error instanceof TargetUnavailableError && error.permanent)
							this.journal.failQueued(
								String(task.id),
								String(turn.id),
								error.message,
							);
						else
							this.journal.setSchedulingBlock(
								String(task.id),
								error instanceof Error
									? error.message
									: "Target is unavailable",
							);
						this.changed();
						continue;
					}
				}
				this.journal.setSchedulingBlock(String(task.id), null);
				try {
					this.journal.start(String(task.id), String(turn.id), owner);
				} catch {
					continue;
				}
				const active: Active = {
					controller: new AbortController(),
					processKey,
					turnId: String(turn.id),
				};
				this.active.set(String(task.id), active);
				if (processKey) this.held.set(processKey, String(task.id));
				this.changed();
				const execution = this.execute(task, turn, input, owner, active);
				this.executions.add(execution);
				void execution.then(
					() => this.executions.delete(execution),
					() => this.executions.delete(execution),
				);
			}
		} finally {
			this.pumping = false;
		}
	}
	private async execute(
		task: Row,
		turn: Row,
		input: Submission,
		owner: ExecutionOwner | null,
		active: Active,
	): Promise<void> {
		const taskId = String(task.id),
			turnId = String(turn.id);
		let failure: unknown = null,
			clean = false,
			evidence: unknown = null;
		try {
			if (owner) await this.options.validateBinding(owner);
			if (active.controller.signal.aborted)
				throw new Error("Cancelled before driver start");
			const continuation = this.snapshot().questions.find(
				(q) => q.continuation_id === turn.id,
			);
			const handoff = this.snapshot().records.find(
				(r) =>
					r.kind === "handoff" &&
					r.state === "completed" &&
					JSON.parse(String(r.payload)).continuationId === turn.id,
			);
			active.driver = await this.options.createDriver({
				taskId,
				turnId,
				sessionId: String(task.session_id),
				conversationId: String(task.conversation_id),
				parentTaskId: task.parent_task_id === null ? null : String(task.parent_task_id),
				binding: owner?.binding ?? null,
				messageTarget: input.messageTarget,
				accessibleBindings: input.bindings,
				owner,
				text: input.text,
				attachments: input.attachments,
				continuation: continuation
					? {
							questionId: continuation.id,
							payload: JSON.parse(String(continuation.payload)),
							answer: JSON.parse(String(continuation.answer)),
						}
					: handoff
						? { documentAction: JSON.parse(String(handoff.payload)) }
						: null,
				signal: active.controller.signal,
				ask: (toolCallId, payload) => {
					if (active.controller.signal.aborted)
						throw new Error("Task cancelled");
					const id = this.journal.ask(taskId, turnId, toolCallId, payload);
					this.changed();
					return id;
				},
				requestDocumentAction: (grantId) => {
					if (!this.documentActionExecutor || active.controller.signal.aborted)
						throw new Error("Document actions unavailable");
					const id = this.journal.beginHandoff(taskId, turnId, grantId);
					this.changed();
					return id;
				},
				publish: (payload) => {
					this.journal.publish(taskId, payload);
					this.changed();
				},
			});
			if (active.controller.signal.aborted) {
				await active.driver.cancel();
				throw new Error("Cancelled before model start");
			}
			const result = await active.driver.run();
			if (result?.usage !== undefined)
				this.journal.recordUsage(taskId, turnId, result.usage);
			if (
				task.parent_task_id === null &&
				!active.controller.signal.aborted &&
				this.snapshot().tasks.find((task) => task.id === taskId)?.state ===
					"running"
			)
				await this.waitForChildren(taskId);
		} catch (error) {
			failure = error;
			const usage = (error as { usage?: unknown } | null)?.usage;
			if (typeof usage === "number" && Number.isFinite(usage) && usage >= 0)
				this.journal.recordUsage(taskId, turnId, usage);
		}
		try {
			const cleanup = active.driver
				? await active.driver.cleanup()
				: {
						confirmed:
							(failure as { cleanupConfirmed?: boolean } | null)
								?.cleanupConfirmed !== false,
					};
			clean = cleanup.confirmed;
			evidence = cleanup.evidence ?? null;
		} catch (error) {
			evidence = String(error);
		}
		const unknown =
			this.snapshot().operations.some(
				(op) =>
					op.turn_id === turnId &&
					["dispatched", "uncertain"].includes(String(op.state)),
			) ||
			this.snapshot().records.some(
				(record) =>
					record.kind === "scope" &&
					record.state === "uncertain" &&
					JSON.parse(String(record.payload)).turnId === turnId,
			);
		try {
			const state = this.snapshot().tasks.find((row) => row.id === taskId)!;
			if (!clean || unknown)
				this.journal.uncertain(taskId, turnId, {
					cleanup: evidence,
					error: failure ? String(failure) : null,
				});
			else if (active.controller.signal.aborted || state.cancellation_requested)
				this.journal.settle(taskId, turnId, "cancelled");
			else if (state.state === "suspending") {
				const handoff = this.snapshot().records.find(
					(r) =>
						r.kind === "handoff" &&
						r.task_id === taskId &&
						r.state === "suspending",
				);
				if (!handoff) this.journal.confirmSuspension(taskId, turnId);
				else {
					const actionTurnId = this.journal.startHandoffAction(
						taskId,
						turnId,
						String(handoff.id),
					);
					if (active.processKey) this.held.delete(active.processKey);
					active.processKey = undefined;
					active.turnId = actionTurnId;
					this.changed();
					this.pump();
					try {
						const result = await this.documentActionExecutor!(
							JSON.parse(String(handoff.payload)).grantId,
						);
						this.journal.completeHandoff(
							taskId,
							actionTurnId,
							String(handoff.id),
							result,
						);
					} catch (error) {
						const unresolved =
							this.snapshot().operations.some(
								(op) =>
									op.turn_id === actionTurnId &&
									["dispatched", "uncertain"].includes(String(op.state)),
							) ||
							this.snapshot().records.some(
								(record) =>
									record.kind === "scope" &&
									record.state === "uncertain" &&
									JSON.parse(String(record.payload)).turnId === actionTurnId,
							);
						if (unresolved)
							this.journal.uncertain(taskId, actionTurnId, {
								error: String(error),
							});
						else if (active.controller.signal.aborted)
							this.journal.settle(taskId, actionTurnId, "cancelled");
						else this.journal.failRunning(taskId, actionTurnId, String(error));
					}
				}
			} else if (failure)
				this.journal.failRunning(taskId, turnId, String(failure));
			else this.journal.settle(taskId, turnId, "completed");
			if (clean && !unknown && active.processKey)
				this.held.delete(active.processKey);
		} catch (error) {
			this.journal.uncertain(taskId, active.turnId, { error: String(error) });
		} finally {
			this.active.delete(taskId);
			this.changed();
			this.pump();
		}
	}
}
