import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
	DocumentActionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";
import { NativeActionError } from "./action-errors.js";
import { withToolDispatchContext } from "../../services/tool-policy-context.js";
import type { DocumentRequest } from "../../types/document-management.js";
import { validateDocumentRequest } from "../../services/document-management.js";
import { SharedTaskService } from "./task-service.js";

export interface DocumentActionRequest {
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
	createDirectories?: boolean;
}
export interface DocumentActionPreflight {
	destinations: { identity: string; baseline: unknown }[];
	arguments?: DocumentRequest;
	baselines?: { path: string; baseline: unknown }[];
}
export interface DocumentActionAdapter {
	/** Inspect every affected document and destination again while owning the queue. */
	preflight(grant: DocumentActionRequest, signal?: AbortSignal): Promise<DocumentActionPreflight>;
	execute(
		owner: DocumentActionOwner,
		grant: DocumentActionRequest,
		operationId: string,
		preflight: DocumentActionPreflight,
	): Promise<{ binding: TargetBinding; result: unknown }>;
	verify(binding: TargetBinding, grant: DocumentActionRequest): Promise<void>;
}
const stable = (prefix: string, id: string) =>
	prefix + createHash("sha256").update(id).digest("hex").slice(0, 32);
/** Host-owned action tracking. Legacy journal/wire grant IDs are internal dispatch receipts. */
export class DocumentActionService {
	constructor(
		private readonly journal: TaskJournal,
		private readonly scheduler: SharedTaskService,
		private readonly adapter: DocumentActionAdapter,
		private readonly admit: (kind: "rhino" | "grasshopper") => Promise<void> = async () => {},
	) {}
	prepareForTask(context: Pick<import("./task-service.js").DriverContext, "taskId" | "binding" | "accessibleBindings">,
		toolCallId: string, kind: "rhino" | "grasshopper", request: import("../../types/document-management.js").DocumentRequest): string {
		const bindings = [...(context.accessibleBindings ?? []), ...(context.binding ? [context.binding] : []), ...this.journal.authorizationAdditions(context.taskId)];
		const available = new Set(bindings.map(binding => binding.lifecycleInstanceId));
		const lifecycleInstanceId = request.lifecycleInstanceId ?? context.binding?.lifecycleInstanceId
			?? (available.size === 1 ? [...available][0] : undefined);
		if (!lifecycleInstanceId) throw new Error(available.size ? "Choose a process from listRhinoTargets using lifecycleInstanceId." : "Open Rhino and run HopperCode, then select its target.");
		if (!available.has(lifecycleInstanceId)) throw new Error("Choose a process accessible to this task.");
		if (request.action !== "new" && request.action !== "open") throw new Error("Expected a create or open action.");
		if (request.onUnsaved && !["fail", "save", "discard"].includes(request.onUnsaved)) throw new Error("Invalid onUnsaved policy.");
		return this.prepare({ requestId: `${context.taskId}:${toolCallId}`, taskId: context.taskId,
			lifecycleInstanceId, kind, action: request.action,
			modifiedPolicy: request.onUnsaved === "save" || request.onUnsaved === "discard" ? request.onUnsaved : "refuse",
			...(request.path !== undefined ? { path: request.path } : {}), ...(request.templatePath !== undefined ? { templatePath: request.templatePath } : {}),
			...(request.savePath !== undefined ? { savePath: request.savePath } : {}), ...(request.overwrite !== undefined ? { overwrite: request.overwrite } : {}),
			...(request.createDirectories !== undefined ? { createDirectories: request.createDirectories } : {}),
		}).grantId;
	}
	prepare(grant: DocumentActionRequest): { grantId: string; actionId: string } {
		const task = this.journal.getTask(grant.taskId);
		if (
			!task ||
			task.parent_task_id !== null ||
			task.cancellation_requested ||
			!["running", "queued"].includes(String(task.state))
		)
			throw new Error("Only a live root task can create or open a document");
		if (
			!["rhino", "grasshopper"].includes(grant.kind) ||
			!["new", "open"].includes(grant.action) ||
			!["refuse", "save", "discard"].includes(grant.modifiedPolicy) ||
			!grant.lifecycleInstanceId
		)
			throw new Error("Invalid bounded document action");
		if (grant.action === "open" && (!grant.path || !isAbsolute(grant.path)))
			throw new Error("Open requires an absolute path");
		if (grant.templatePath && !isAbsolute(grant.templatePath))
			throw new Error("Template path must be absolute");
		if (
			grant.modifiedPolicy === "save" &&
			grant.savePath &&
			!isAbsolute(grant.savePath)
		)
			throw new Error("Save path must be absolute");
		validateDocumentRequest(grant.kind, { action: grant.action, path: grant.path, templatePath: grant.templatePath, savePath: grant.savePath, onUnsaved: grant.modifiedPolicy === "refuse" ? "fail" : grant.modifiedPolicy, expectedActiveDocument: null, affectedDocuments: [] });
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
		const grantRecord = this.journal.getRecord("grant", grantId);
		if (!grantRecord) throw new Error("Unknown document action");
		const grant = JSON.parse(String(grantRecord.payload)) as DocumentActionRequest,
			actionId = stable("document-", grant.requestId);
		const action = this.journal.getRecord("document-action", actionId)!;
		if (action.state === "completed") return JSON.parse(String(action.payload));
		if (grantRecord.state !== "accepted" || action.state !== "accepted")
			throw new Error(
				"Document action needs reconciliation before another dispatch",
			);
		return this.scheduler.withLifecycle(
			grant.taskId,
			grant.lifecycleInstanceId,
			async (target) => withToolDispatchContext(() => this.admit(grant.kind), async () => {
				await this.admit(grant.kind);
				const preflight = await this.adapter.preflight(grant, target.signal);
				await this.admit(grant.kind);
				if (this.journal.getTask(grant.taskId)?.cancellation_requested) throw new Error("Task cancellation requested");
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
						preflight,
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
						this.journal.getOperation(operation.id)?.state ===
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
			}),
		);
	}
}
