import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
	DocumentActionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";
import { NativeActionError } from "./action-errors.js";
import { SharedTaskService } from "./task-service.js";

export interface DocumentGrant {
	requestId: string;
	taskId: string;
	lifecycleInstanceId: string;
	kind: "rhino" | "grasshopper";
	action: "new" | "open";
	path?: string;
	templatePath?: string;
	/** Refuse changes to modified documents unless exact handling was authorized. */
	modifiedPolicy: "refuse" | "save" | "discard";
	savePath?: string;
	overwrite?: boolean;
}
export interface DocumentActionAdapter {
	/** Inspect every affected document and destination again while owning the queue. */
	preflight(grant: DocumentGrant): Promise<{
		destinations: { identity: string; baseline: unknown }[];
		arguments?: unknown;
	}>;
	execute(
		owner: DocumentActionOwner,
		grant: DocumentGrant,
		operationId: string,
	): Promise<{ binding: TargetBinding; result: unknown }>;
	verify(binding: TargetBinding, grant: DocumentGrant): Promise<void>;
}
const stable = (prefix: string, id: string) =>
	prefix + createHash("sha256").update(id).digest("hex").slice(0, 32);
/** Grants are exact user-authorized actions; a worker cannot issue or enlarge one. */
export class DocumentGrantService {
	constructor(
		private readonly journal: TaskJournal,
		private readonly scheduler: SharedTaskService,
		private readonly adapter: DocumentActionAdapter,
	) {}
	authorize(grant: DocumentGrant): { grantId: string; actionId: string } {
		const task = this.journal
			.snapshot()
			.tasks.find((task) => task.id === grant.taskId);
		if (
			!task ||
			task.parent_task_id !== null ||
			task.cancellation_requested ||
			!["running", "queued"].includes(String(task.state))
		)
			throw new Error("Only a live root task can receive a document grant");
		if (
			!["rhino", "grasshopper"].includes(grant.kind) ||
			!["new", "open"].includes(grant.action) ||
			!["refuse", "save", "discard"].includes(grant.modifiedPolicy) ||
			!grant.lifecycleInstanceId
		)
			throw new Error("Invalid bounded document action");
		if (grant.action === "open" && (!grant.path || !isAbsolute(grant.path)))
			throw new Error("Open grant requires an absolute path");
		if (grant.templatePath && !isAbsolute(grant.templatePath))
			throw new Error("Template path must be absolute");
		if (
			grant.modifiedPolicy === "save" &&
			grant.savePath &&
			!isAbsolute(grant.savePath)
		)
			throw new Error("Save path must be absolute");
		const grantId = stable("grant-", grant.requestId),
			actionId = stable("document-", grant.requestId);
		this.journal.putRecord(
			grant.requestId,
			"grant",
			grantId,
			grant.taskId,
			grant,
		);
		this.journal.putRecord(
			grant.requestId + ":action",
			"document-action",
			actionId,
			grant.taskId,
			{ grantId, grant },
		);
		return { grantId, actionId };
	}
	async execute(
		grantId: string,
	): Promise<{ binding: TargetBinding; result: unknown; actionId: string }> {
		const grantRecord = this.journal
			.snapshot()
			.records.find(
				(record) => record.kind === "grant" && record.id === grantId,
			);
		if (!grantRecord) throw new Error("Unknown document grant");
		const grant = JSON.parse(String(grantRecord.payload)) as DocumentGrant,
			actionId = stable("document-", grant.requestId);
		const action = this.journal
			.snapshot()
			.records.find(
				(record) => record.kind === "document-action" && record.id === actionId,
			)!;
		if (action.state === "completed") return JSON.parse(String(action.payload));
		if (grantRecord.state !== "accepted" || action.state !== "accepted")
			throw new Error(
				"Document action needs reconciliation before another dispatch",
			);
		return this.scheduler.withLifecycle(
			grant.taskId,
			grant.lifecycleInstanceId,
			async (target) => {
				const preflight = await this.adapter.preflight(grant);
				const owner: DocumentActionOwner = {
					taskId: grant.taskId,
					turnId: target.turnId,
					actionId,
					grantId,
					lifecycleInstanceId: grant.lifecycleInstanceId,
					attachmentGeneration: target.attachmentGeneration,
				};
				const operation = this.journal.operationIntent({
					taskId: grant.taskId,
					turnId: target.turnId,
					name:
						grant.kind === "rhino"
							? "manageRhinoDocument"
							: "manageGrasshopperDocument",
					operationClass: "mutation",
					owner,
					grantId,
					reservations: preflight.destinations,
					arguments: preflight.arguments ?? { actionId, grant },
					record: {
						kind: "document-action",
						id: actionId,
						expected: "accepted",
						payload: { grantId, grant },
					},
					deadline: Date.now() + 120_000,
				});
				try {
					const result = await this.adapter.execute(
						owner,
						grant,
						operation.operationId!,
					);
					this.journal.operationResult(operation.id, "completed", result);
					if (
						result.binding.lifecycleInstanceId !== grant.lifecycleInstanceId ||
						result.binding.kind !== grant.kind
					)
						throw new Error(
							"Document action returned another lifecycle or kind",
						);
					await this.adapter.verify(result.binding, grant);
					const receipt = { ...result, actionId };
					this.journal.completeGrantedAction(
						"document-action",
						actionId,
						grantId,
						result.binding,
						receipt,
					);
					return receipt;
				} catch (error) {
					if (
						this.journal
							.snapshot()
							.operations.find((op) => op.id === operation.id)?.state ===
						"dispatched"
					)
						this.journal.operationResult(
							operation.id,
							error instanceof NativeActionError ? error.outcome : "uncertain",
							{
								error: String(error),
								evidence:
									error instanceof NativeActionError ? error.evidence : null,
							},
						);
					this.journal.transitionRecord(
						"document-action",
						actionId,
						"dispatched",
						error instanceof NativeActionError &&
							["failed", "cancelled"].includes(error.outcome)
							? error.outcome
							: "uncertain",
						{ grantId, operationId: operation.id, error: String(error) },
					);
					throw error;
				}
			},
		);
	}
}
