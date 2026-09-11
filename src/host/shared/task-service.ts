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
	/** Serialize a native tool through cleanup, without reserving Rhino during model inference. */
	withNativeTool?<T>(work: () => Promise<T>): Promise<T>;
	ask(toolCallId: string, payload: unknown): string;
	requestDocumentAction(grantId: string): string;
	publish(payload: unknown): void;
}
export interface TaskDriver {
	toolSettings?: Pick<import("../pi-runtime.js").HostRuntime, "getToolSettings" | "updateToolSettings">;
	run(): Promise<{ usage?: number } | void>;
	steer(payload: unknown, inputId?: number): Promise<void>;
	cancel(): void | Promise<void>;
	cleanup(): Promise<{ confirmed: boolean; evidence?: unknown }>;
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
	/** Token budget for one root request, including its continuations and children. */
	maxUsage?: number;
}
interface Active {
	controller: AbortController;
	driver?: TaskDriver;
	processKey?: string;
	worker: boolean;
	waitingForChildren?: boolean;
	nativeRecoveryRequired?: boolean;
	turnId: string;
}
/** Owns model lifetimes independently of browser connections. */
export class SharedTaskService {
	private readonly active = new Map<string, Active>();
	private readonly held = new Map<string, string>();
	private readonly processQueues = new Map<string, object[]>();
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
		// Restore process fences for interrupted tasks and managed actions.
		const snapshot = journal.schedulingSnapshot(),
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
					JSON.parse(String(record.owner)), snapshot,
				);
				if (processKey) this.held.set(processKey, String(record.task_id));
			}
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	toolSettings(conversationId: string, taskId: string) {
		const task = this.journal.getTask(taskId);
		return task?.conversation_id === conversationId ? this.active.get(taskId)?.driver?.toolSettings : undefined;
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
	private schedulingSnapshot(taskIds: string[] = []) {
		return this.journal.schedulingSnapshot([...this.active.keys(), ...this.held.values(), ...taskIds]);
	}
	private workerCount(): number {
		return [...this.active.values()].filter((active) => active.worker && !active.waitingForChildren).length;
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
		if (this.usage(input.parentTaskId) >= (this.options.maxUsage ?? Infinity))
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
			const state = this.journal.getInputState(inputId);
			if (state !== "accepted") return;
			const active = this.active.get(taskId);
			if (!active) return;
			while (!active.driver && this.active.get(taskId) === active && !active.controller.signal.aborted)
				await this.waitForChange(active);
			if (!active.driver || this.active.get(taskId) !== active || active.controller.signal.aborted ||
				this.journal.getInputState(inputId) !== "accepted") return;
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
				const snapshot = this.schedulingSnapshot([id]),
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
		// Request cancellation for every root even if one driver never acknowledges it.
		await Promise.all(this.schedulingSnapshot().tasks
			.filter(task => ["queued", "running", "suspending", "awaiting_user"].includes(String(task.state)))
			.map(task => this.cancel(String(task.id))));
		await Promise.allSettled([...this.executions]);
	}
	releaseRecovered(taskId: string): void {
		if (!this.schedulingSnapshot([taskId]).recoveries.some((row) => row.task_id === taskId))
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
		const snapshot = this.schedulingSnapshot();
		if (!active || snapshot.tasks.find((task) => task.id === taskId)?.parent_task_id !== null)
			throw new Error("Only an active root task can wait for children");
		const settled = (task: Row) => ["completed", "failed", "cancelled", "interrupted", "uncertain"].includes(String(task.state));
		const pending = snapshot.tasks.some((task) => task.parent_task_id === taskId && !settled(task));
		const releaseModelSlot = pending && active.worker;
		if (releaseModelSlot) {
			active.waitingForChildren = true;
			this.changed();
			this.pump();
		}
		try {
			while (true) {
				if (active.controller.signal.aborted) throw new Error("Task cancelled");
				const snapshot = this.schedulingSnapshot();
				const tasks = snapshot.tasks.filter((task) => task.parent_task_id === taskId);
				if (tasks.every(settled)) {
					const ids = new Set(tasks.map((task) => task.id));
					return { tasks, usage: snapshot.turns.filter((turn) => ids.has(turn.task_id)).reduce((sum, turn) => sum + Number(turn.usage), 0) };
				}
				await this.waitForChange(active);
			}
		} finally {
			if (releaseModelSlot) {
				while (!active.controller.signal.aborted && this.workerCount() >= (this.options.maxWorkers ?? 4))
					await this.waitForChange(active);
				active.waitingForChildren = false;
				this.changed();
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

	private async withNativeTool<T>(owner: ExecutionOwner, work: () => Promise<T>): Promise<T> {
		const active = this.active.get(owner.taskId);
		if (!active || active.turnId !== owner.turnId) throw new Error("Native tool requires an active turn");
		return this.withProcessLease(owner.taskId, owner.binding.lifecycleInstanceId, () => {
			const target = this.options.resolveBinding(owner.binding);
			if (target.attachmentGeneration !== owner.attachmentGeneration)
				throw new Error("Native tool target attachment changed while waiting");
			return target;
		}, async () => {
			await this.options.validateBinding(owner);
			return work();
		});
	}

	/** All native tools and managed actions take turns in the same process queue. */
	private async withProcessLease<T>(
		taskId: string,
		lifecycleId: string,
		resolveTarget: () => { processKey: string; attachmentGeneration: string },
		work: (target: { processKey: string; attachmentGeneration: string }) => Promise<T>,
	): Promise<T> {
		const active = this.active.get(taskId);
		if (!active || active.controller.signal.aborted) throw new Error("Task cancelled or ended");
		const original = resolveTarget();
		const { processKey } = original;
		const queue = this.processQueues.get(processKey) ?? [];
		this.processQueues.set(processKey, queue);
		const ticket = {};
		queue.push(ticket);
		let acquired = false;
		let reportedWait = false;
		try {
			while (true) {
				if (active.controller.signal.aborted || this.active.get(taskId) !== active)
					throw new Error("Task cancelled or ended before native execution");
				const target = resolveTarget();
				if (target.processKey !== processKey || target.attachmentGeneration !== original.attachmentGeneration)
					throw new Error("Native target attachment changed while waiting");
				const heldBy = this.held.get(processKey);
				const snapshot = this.schedulingSnapshot();
				const blockingTaskId = this.unresolvedProcess(processKey, snapshot);
				if (blockingTaskId) {
					const task = snapshot.tasks.find((task) => task.id === blockingTaskId);
					const conversation = snapshot.conversations.find((conversation) => conversation.id === task?.conversation_id);
					throw new Error(
						`Rhino requires recovery because Hopper could not confirm native cleanup for task ${blockingTaskId}` +
						(conversation ? ` in conversation ${JSON.stringify(conversation.title)} (${conversation.id})` : "") +
						`. This is Hopper task recovery; it does not indicate a Rhino crash or autosave dialog. ` +
						`Stop native tool calls. Open the affected conversation and stop or wait for that task. Then inspect the model and saved files and use "I've checked, continue".`,
					);
				}
				if (queue[0] === ticket && !heldBy) {
					this.held.set(processKey, taskId);
					active.processKey = processKey;
					acquired = true;
					this.journal.setSchedulingBlock(taskId, null);
					this.changed();
					return await work(target);
				}
				if (!reportedWait) {
					this.journal.setSchedulingBlock(taskId, "Waiting to use Rhino. Other agents can keep thinking while a native tool runs.", heldBy);
					reportedWait = true;
					this.changed();
				}
				await this.waitForChange(active);
			}
		} finally {
			queue.splice(queue.indexOf(ticket), 1);
			if (!queue.length) this.processQueues.delete(processKey);
			if (acquired) {
				const snapshot = this.schedulingSnapshot();
				const unknown = snapshot.operations.some((op) => {
					if (op.task_id !== taskId || !["dispatched", "uncertain"].includes(String(op.state))) return false;
					const owner = JSON.parse(String(op.owner ?? "null"));
					return (owner?.binding?.lifecycleInstanceId ?? owner?.lifecycleInstanceId) === lifecycleId;
				}) || snapshot.records.some((record) =>
					(record.kind === "scope" || record.kind === "document-action") && record.task_id === taskId && record.state === "uncertain");
				if (!unknown && this.held.get(processKey) === taskId) this.held.delete(processKey);
				active.nativeRecoveryRequired = unknown;
				active.processKey = undefined;
			}
			this.journal.setSchedulingBlock(taskId, null);
			this.changed();
			this.pump();
		}
	}

	async withProcess<T>(
		taskId: string,
		binding: TargetBinding,
		work: (owner: ExecutionOwner) => Promise<T>,
	): Promise<T> {
		const active = this.active.get(taskId);
		if (!active || active.controller.signal.aborted)
			throw new Error("Managed action requires an active task");
		if (active.processKey || [...this.held.values()].includes(taskId))
			throw new Error("Direct edit scope must finish a durable handoff before a document or transfer action");
		const input = JSON.parse(
			String(this.journal.getTask(taskId)!.payload),
		) as Submission;
		const normalized = (b: TargetBinding) => b.kind === "rhino"
			? [b.kind, b.lifecycleInstanceId, b.rhinoDocumentId].join("|")
			: [b.kind, b.lifecycleInstanceId, b.grasshopperDocumentId, b.associatedRhinoDocumentId].join("|");
		if (![...input.bindings, ...this.journal.authorizationAdditions(taskId)].some((b) => normalized(b) === normalized(binding)))
			throw new Error("Managed action target is not authorized");
		return this.withProcessLease(taskId, binding.lifecycleInstanceId, () => this.options.resolveBinding(binding), async (target) => {
			const owner: ExecutionOwner = Object.freeze({
				taskId, turnId: active.turnId, binding: Object.freeze({ ...binding }),
				attachmentGeneration: target.attachmentGeneration,
			});
			await this.options.validateBinding(owner);
			return work(owner);
		});
	}

	async withLifecycle<T>(
		taskId: string,
		lifecycleId: string,
		work: (target: { turnId: string; attachmentGeneration: string }) => Promise<T>,
	): Promise<T> {
		const active = this.active.get(taskId);
		const resolveLifecycle = this.options.resolveLifecycle;
		if (!active || active.controller.signal.aborted || !resolveLifecycle)
			throw new Error("Lifecycle action is unavailable");
		if (active.processKey || [...this.held.values()].includes(taskId))
			throw new Error("Finish direct scope handoff before a lifecycle action");
		return this.withProcessLease(taskId, lifecycleId, () => resolveLifecycle(lifecycleId), (target) => work({
			turnId: active.turnId, attachmentGeneration: target.attachmentGeneration,
		}));
	}

	private processOfOwner(owner: any, snapshot = this.schedulingSnapshot()): string | undefined {
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
		const attachment = snapshot.attachments.find(
			(row) => row.lifecycle_id === lifecycleId,
		);
		if (attachment) {
			const value = JSON.parse(String(attachment.payload));
			return `${value.processId}:${value.processStartTime}`;
		}
	}
	private unresolvedProcess(processKey: string, snapshot = this.schedulingSnapshot()): string | undefined {
		// A failed native tool fences the process immediately, even while its model
		// is still responding and the task has not settled as uncertain yet.
		const heldBy = this.held.get(processKey);
		if (heldBy && (!this.active.has(heldBy) || this.active.get(heldBy)!.nativeRecoveryRequired))
			return heldBy;
		const unresolved = new Set(
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
				this.processOfOwner(JSON.parse(String(record.owner)), snapshot) === processKey,
		);
		return record ? String(record.task_id) : undefined;
	}
	private recoveryWaitReason(taskId: string, snapshot: ReturnType<TaskJournal["schedulingSnapshot"]>): string {
		const task = snapshot.tasks.find((task) => task.id === taskId);
		const conversation = snapshot.conversations.find((conversation) => conversation.id === task?.conversation_id);
		return "Waiting for recovery of an earlier task in this Rhino instance." +
			(conversation ? ` Open conversation ${JSON.stringify(conversation.title)}. Stop or wait for the affected task, then check your model and saved files and select "I've checked, continue".` : "");
	}

	private usage(taskId: string, snapshot = this.schedulingSnapshot([taskId])): number {
		const task = snapshot.tasks.find((task) => task.id === taskId);
		const rootId = task?.root_task_id ?? taskId;
		const ids = new Set(snapshot.tasks
			.filter((task) => task.id === rootId || task.root_task_id === rootId)
			.map((task) => task.id));
		return snapshot.turns.reduce((total, turn) =>
			total + (ids.has(turn.task_id) ? Number(turn.usage) : 0), 0);
	}
	pump(): void {
		if (this.pumping || this.stopped || !this.journal.hasQueuedTasks) return;
		this.pumping = true;
		try {
			const snapshot = this.schedulingSnapshot();
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
				if (this.usage(String(task.id), snapshot) >= (this.options.maxUsage ?? Infinity)) {
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
				const input = JSON.parse(String(task.payload)) as Pick<Submission, "bindings" | "messageTarget">;
				// Access to other documents never removes the selected document owner.
				const handoff = snapshot.records.find(
					(r) =>
						r.kind === "handoff" &&
						r.state === "completed" &&
						JSON.parse(String(r.payload)).continuationId === turn.id,
				);
				const question = snapshot.questions.find(q => q.continuation_id === turn.id);
				const questionOwner = question
					? JSON.parse(String(snapshot.turns.find(t => t.id === question.turn_id)?.owner ?? "null")) as ExecutionOwner | null
					: null;
				// Answers keep the document that asked, including a prior create/open handoff.
				const binding = handoff
					? (JSON.parse(String(handoff.payload)).binding as TargetBinding)
					: question ? questionOwner?.binding ?? null
						: input.messageTarget ?? (input.bindings.length === 1 ? input.bindings[0]! : null);
				if (
					!binding &&
					[...this.active.values()].filter(
						(active) => !active.worker,
					).length >= (this.options.maxCoordinators ?? 4)
				)
					continue;
				let owner: ExecutionOwner | null = null;
				if (binding) {
					if (
						this.workerCount() >= (this.options.maxWorkers ?? 4)
					)
						continue;
					try {
						const target = this.options.resolveBinding(binding);
						const blockingTaskId = this.unresolvedProcess(target.processKey, snapshot);
						if (blockingTaskId) {
							this.journal.setSchedulingBlock(String(task.id), this.recoveryWaitReason(blockingTaskId, snapshot), blockingTaskId);
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
					worker: !!binding,
					turnId: String(turn.id),
				};
				this.active.set(String(task.id), active);
				this.changed();
				const submission = JSON.parse(String(this.journal.getTask(String(task.id))!.payload)) as Submission;
				const execution = this.execute(task, turn, submission, owner, active);
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
			const snapshot = this.schedulingSnapshot();
			const continuationId = snapshot.questions.find(q => q.continuation_id === turn.id)?.id;
			const continuation = continuationId ? this.journal.getQuestion(String(continuationId)) : undefined;
			const handoff = snapshot.records.find(
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
						? { documentAction: JSON.parse(String(this.journal.getRecord("handoff", String(handoff.id))!.payload)) }
						: null,
				signal: active.controller.signal,
				...(owner
					? { withNativeTool: <T>(work: () => Promise<T>) => this.withNativeTool(owner, work) } : {}),
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
			this.changed();
			const result = await active.driver.run();
			if (result?.usage !== undefined)
				this.journal.recordUsage(taskId, turnId, result.usage);
			if (
				task.parent_task_id === null &&
				!active.controller.signal.aborted &&
				this.schedulingSnapshot().tasks.find((task) => task.id === taskId)?.state ===
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
		const snapshot = this.schedulingSnapshot();
		const unknown =
			snapshot.operations.some(
				(op) =>
					op.turn_id === turnId &&
					["dispatched", "uncertain"].includes(String(op.state)),
			) ||
			snapshot.records.some(
				(record) =>
					record.kind === "scope" &&
					record.state === "uncertain" &&
					JSON.parse(String(record.payload)).turnId === turnId,
			);
		try {
			const state = snapshot.tasks.find((row) => row.id === taskId)!;
			if (!clean || unknown)
				this.journal.uncertain(taskId, turnId, {
					cleanup: evidence,
					error: failure ? String(failure) : null,
				});
			else if (active.controller.signal.aborted || state.cancellation_requested)
				this.journal.settle(taskId, turnId, "cancelled");
			else if (state.state === "suspending") {
				const handoff = snapshot.records.find(
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
					active.turnId = actionTurnId;
					// The model session was disposed during cleanup; settings now use the host profile.
					active.driver = undefined;
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
						const snapshot = this.schedulingSnapshot();
						const unresolved =
							snapshot.operations.some(
								(op) =>
									op.turn_id === actionTurnId &&
									["dispatched", "uncertain"].includes(String(op.state)),
							) ||
							snapshot.records.some(
								(record) =>
									(record.kind === "document-action" && record.task_id === taskId && record.state === "uncertain") ||
									(record.kind === "scope" && record.state === "uncertain" && JSON.parse(String(record.payload)).turnId === actionTurnId),
							);
						if (unresolved)
							this.journal.uncertain(taskId, actionTurnId, {
								error: String(error),
							});
						else if (active.controller.signal.aborted)
							this.journal.settle(taskId, actionTurnId, "cancelled");
						else this.journal.completeHandoff(taskId, actionTurnId, String(handoff.id), { binding: owner?.binding ?? null, actionId: String(handoff.id), failed: true, result: { ok: false, error: String(error) } });
					}
				}
			} else if (failure)
				this.journal.failRunning(taskId, turnId, String(failure));
			else this.journal.settle(taskId, turnId, "completed");
		} catch (error) {
			this.journal.uncertain(taskId, active.turnId, { error: String(error) });
		} finally {
			this.active.delete(taskId);
			this.changed();
			this.pump();
		}
	}
}
