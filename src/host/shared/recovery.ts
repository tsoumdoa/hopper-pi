import { isAbsolute } from "node:path";
import type { HopperRpcClient } from "../../infra/rpc-client.js";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedTaskService } from "./task-service.js";
import { inspectDestination } from "./native-actions.js";

export interface RecoveryNative {
	getClient(lifecycleId: string): HopperRpcClient;
	reconcileAttachment(lifecycleId: string): Promise<{
		attachmentGeneration: string;
		operationsIdle: boolean;
		rhinoScopeIdle: boolean;
		grasshopperScopeIdle: boolean;
		evidence?: unknown;
	}>;
}
export interface RecoveryProcessProbe {
	originalExited(pid: number, startIdentity: string): Promise<boolean>;
}
const processProbe: RecoveryProcessProbe = {
	originalExited: async (pid) => {
		try {
			process.kill(pid, 0);
			return false;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	},
};
/** Acknowledgement records permission for fresh work; it never rewrites unknown edits. */
export class SharedRecoveryService {
	constructor(
		private readonly journal: TaskJournal,
		private readonly registry: SharedRegistry,
		private readonly tasks: SharedTaskService,
		private readonly native: RecoveryNative,
		private readonly probe: RecoveryProcessProbe = processProbe,
	) {}
	async recover(
		requestId: string,
		taskId: string,
		acknowledgement: string,
	): Promise<{ id: string }> {
		if (typeof acknowledgement !== "string" || !acknowledgement.trim())
			throw new Error(
				"Acknowledge inspection of the affected models and files before releasing unknown work",
			);
		const request = { kind: "recover_task", taskId, acknowledgement };
		const prior = this.journal.findRequest<{ id: string }>(requestId, request);
		if (prior) return prior;
		const task = this.journal.getTask(taskId);
		if (task?.state !== "uncertain") throw new Error("Task is not uncertain");
		const operations = this.journal.getTaskOperations(taskId);
		const lifecycleIds = new Set<string>();
		for (const record of [
			...this.journal.getTaskTurns(taskId),
			...operations,
		]) {
			const owner = record.owner ? JSON.parse(String(record.owner)) : null;
			const lifecycleId =
				owner?.binding?.lifecycleInstanceId ?? owner?.lifecycleInstanceId;
			if (lifecycleId) lifecycleIds.add(lifecycleId);
		}
		const attachments = this.registry.list(),
			evidence: unknown[] = [],
			retained: unknown[] = [];
		let exited = 0;
		for (const lifecycleId of lifecycleIds) {
			const attachment = attachments.find(
				(attachment) => attachment.lifecycleInstanceId === lifecycleId,
			);
			if (!attachment)
				throw new Error(
					"Original process identity is unavailable; manual recovery is required",
				);
			if (
				await this.probe.originalExited(
					attachment.processId,
					attachment.processStartTime,
				)
			) {
				exited++;
				evidence.push({
					lifecycleId,
					originalProcessExited: true,
					processId: attachment.processId,
					processStartTime: attachment.processStartTime,
				});
				continue;
			}
			const recovery = await this.native.reconcileAttachment(lifecycleId);
			if (
				!recovery.attachmentGeneration ||
				recovery.attachmentGeneration === attachment.attachmentGeneration ||
				!recovery.operationsIdle ||
				!recovery.rhinoScopeIdle ||
				!recovery.grasshopperScopeIdle
			)
				throw new Error(
					"The old native work or transaction cleanup is still unresolved",
				);
			for (const operation of operations) {
				const owner = operation.owner
					? JSON.parse(String(operation.owner))
					: null;
				if (
					(owner?.binding?.lifecycleInstanceId ??
						owner?.lifecycleInstanceId) !== lifecycleId ||
					!operation.wire_id
				)
					continue;
				try {
					const result = await this.native
						.getClient(lifecycleId)
						.call("getOperationResult", {
							operationId: String(operation.wire_id),
						});
					// Retained evidence helps inspection; no native mutation is sent again.
					retained.push({
						operationId: operation.id,
						result: JSON.parse(JSON.stringify(result)),
					});
				} catch (error) {
					retained.push({
						operationId: operation.id,
						evidenceUnavailable: String(error),
					});
				}
			}
			evidence.push({ lifecycleId, ...recovery });
		}
		const reservations = this.journal.getTaskReservations(taskId);
		const files: unknown[] = [];
		for (const operation of operations) {
			const reserved = reservations.filter(
				(reservation) => reservation.operation_id === operation.id,
			);
			if (!reserved.length) continue;
			const args = JSON.parse(String(operation.arguments)) as {
				path?: string;
				expectedDestinations?: { path: string }[];
				affectedDocuments?: { savePath?: string }[];
			};
			const candidates = new Set<string>([
				...(args.expectedDestinations ?? []).map((item) => item.path),
				...(args.affectedDocuments ?? []).flatMap((item) =>
					item.savePath ? [item.savePath] : [],
				),
				...(args.path ? [args.path] : []),
			]);
			for (const reservation of reserved)
				if (String(reservation.destination).startsWith("path:"))
					candidates.add(String(reservation.destination).slice(5));
				else if (isAbsolute(String(reservation.destination)))
					candidates.add(String(reservation.destination));
			if (!candidates.size)
				throw new Error(
					"A reserved destination has no inspectable path; manual recovery is required",
				);
			const inspected = await Promise.all(
				[...candidates].map(async (path) => ({
					path,
					...(await inspectDestination(path)),
				})),
			);
			for (const reservation of reserved) {
				const identity = String(reservation.destination);
				if (
					!identity.startsWith("file:") &&
					!inspected.some(
						(file) =>
							file.identities.includes(identity) ||
							file.canonicalPath === identity,
					)
				)
					throw new Error(
						"A reserved destination could not be identified for inspection",
					);
			}
			files.push({
				operationId: operation.id,
				reservations: reserved,
				inspected,
			});
		}
		// A discussion turn has no process or save ownership to release.
		const allExited = lifecycleIds.size > 0 && exited === lifecycleIds.size;
		const receipt = this.journal.recoveryDisposition(
			requestId,
			taskId,
			{
				acknowledged: true,
				originalProcessExited: allExited,
				authenticatedAndFenced: !allExited,
				operationsIdle: true,
				scopesIdle: true,
				inspectedBaseline: {
					acknowledgement,
					documents: this.registry
						.list()
						.filter((attachment) =>
							lifecycleIds.has(attachment.lifecycleInstanceId),
						),
					files,
				},
				releaseReservations: reservations.length > 0,
				details: { processes: evidence, retained },
			},
			request,
		);
		this.tasks.releaseRecovered(taskId);
		return receipt;
	}
}
