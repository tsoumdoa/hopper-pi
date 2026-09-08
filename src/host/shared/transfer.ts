import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";
import { NativeActionError } from "./action-errors.js";
import { SharedTaskService } from "./task-service.js";

export interface ArtifactManifest {
	artifactId: string;
	format: "3dm";
	checksum: string;
	units: string;
	source: TargetBinding;
	objectIds: string[];
	path: string;
	exportOperationId: string;
	absoluteTolerance: number;
	objectTypes: string[];
	byteLength: number;
	createdAt: number;
}
export interface TransferAdapter {
	/** Must reject unsupported dependencies before writing. Never changes source save path. */
	export(
		owner: ExecutionOwner,
		input: { path: string; objectIds: string[]; operationId: string },
	): Promise<{
		units: string;
		objectIds: string[];
		absoluteTolerance: number;
		objectTypes: string[];
		byteLength: number;
		createdAt: number;
	}>;
	prepareImport?(
		owner: ExecutionOwner,
		destinationUnits: string,
	): Promise<{ expectedSettingsRevision: string }>;
	/** Native adapter repeats checksum, units, binding and destination validation. */
	import(
		owner: ExecutionOwner,
		input: {
			path: string;
			checksum: string;
			sourceUnits: string;
			destinationUnits: string;
			scale: number;
			artifactId: string;
			operationId: string;
			expectedSettingsRevision?: string;
		},
	): Promise<{
		objectIds: string[];
		provenance?: { sourceObjectId: string; destinationObjectId: string }[];
		layerId?: string;
	}>;
}
const metres: Record<string, number> = {
	microns: 1e-6,
	millimeters: 0.001,
	centimeters: 0.01,
	meters: 1,
	kilometers: 1000,
	inches: 0.0254,
	feet: 0.3048,
	yards: 0.9144,
	miles: 1609.344,
};
export function unitScale(source: string, destination: string): number {
	const from = metres[source.toLowerCase()],
		to = metres[destination.toLowerCase()];
	if (!from || !to)
		throw new Error(
			"Geometry transfer requires known source and destination units",
		);
	return from / to;
}
const idFor = (prefix: string, requestId: string) =>
	prefix + createHash("sha256").update(requestId).digest("hex").slice(0, 32);
const checksum = (data: Buffer) =>
	createHash("sha256").update(data).digest("hex");
/** Export and import take separate queue leases, including within one Mac process. */
export class GeometryTransferService {
	constructor(
		private readonly journal: TaskJournal,
		private readonly scheduler: SharedTaskService,
		private readonly artifactsDirectory: string,
		private readonly adapter: TransferAdapter,
	) {}
	async export(input: {
		requestId: string;
		taskId: string;
		source: TargetBinding;
		objectIds: string[];
	}): Promise<ArtifactManifest> {
		input = structuredClone(input);
		if (
			!input.objectIds.length ||
			input.objectIds.some((id) => typeof id !== "string" || !id)
		)
			throw new Error("Select source object identities");
		const artifactId = idFor("artifact-", input.requestId),
			directory = join(resolve(this.artifactsDirectory), artifactId),
			staging = directory + ".staging",
			path = join(staging, "geometry.3dm");
		this.journal.putRecord(
			input.requestId,
			"artifact",
			artifactId,
			input.taskId,
			input,
		);
		const record = this.record("artifact", artifactId);
		if (record.state === "published")
			return this.verify(
				JSON.parse(String(record.payload)) as ArtifactManifest,
			);
		if (record.state === "exported")
			return this.publish(
				artifactId,
				JSON.parse(String(record.payload)) as ArtifactManifest,
				staging,
				directory,
			);
		if (
			record.state !== "accepted" ||
			this.journal
				.snapshot()
				.operations.some(
					(op) =>
						op.task_id === input.taskId &&
						String(op.arguments).includes(artifactId),
				)
		)
			throw new Error(
				"Export outcome needs reconciliation before another dispatch",
			);
		await mkdir(staging, { recursive: true, mode: 0o700 });
		return this.scheduler.withProcess(
			input.taskId,
			input.source,
			async (owner) => {
				const operation = this.journal.operationIntent({
					taskId: input.taskId,
					turnId: owner.turnId,
					name: "exportRhinoArtifact",
					operationClass: "mutation",
					owner,
					reservations: [
						{ identity: resolve(path), baseline: { exists: false } },
					],
					arguments: { path, objectIds: input.objectIds },
					record: {
						kind: "artifact",
						id: artifactId,
						expected: "accepted",
						payload: { ...input, path },
					},
					deadline: Date.now() + 120_000,
				});
				let result: Awaited<ReturnType<TransferAdapter["export"]>>;
				try {
					result = await this.adapter.export(owner, {
						path,
						objectIds: input.objectIds,
						operationId: operation.operationId!,
					});
				} catch (error) {
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
						"artifact",
						artifactId,
						"dispatched",
						error instanceof NativeActionError &&
							["failed", "cancelled"].includes(error.outcome)
							? error.outcome
							: "uncertain",
						{ ...input, operationId: operation.id, path, error: String(error) },
					);
					throw error;
				}
				this.journal.operationResult(operation.id, "completed", result);
				// Validate metadata before publication; native export success does not imply valid transfer metadata.
				unitScale(result.units, result.units);
				const stat = await lstat(path);
				if (
					!Number.isFinite(result.absoluteTolerance) ||
					result.absoluteTolerance <= 0 ||
					!Array.isArray(result.objectTypes) ||
					result.byteLength !== stat.size ||
					!Number.isFinite(result.createdAt)
				)
					throw new Error("Invalid artifact tolerance or provenance metadata");
				if (!stat.isFile() || stat.isSymbolicLink())
					throw new Error("Artifact export did not create a regular .3dm file");
				const manifest: ArtifactManifest = {
					artifactId,
					format: "3dm",
					checksum: checksum(await readFile(path)),
					units: result.units,
					source: input.source,
					objectIds: result.objectIds,
					path: join(directory, "geometry.3dm"),
					exportOperationId: operation.id,
					absoluteTolerance: result.absoluteTolerance,
					objectTypes: result.objectTypes,
					byteLength: result.byteLength,
					createdAt: result.createdAt,
				};
				this.journal.transitionRecord(
					"artifact",
					artifactId,
					"dispatched",
					"exported",
					manifest,
				);
				return this.publish(artifactId, manifest, staging, directory);
			},
		);
	}
	private async publish(
		id: string,
		manifest: ArtifactManifest,
		staging: string,
		directory: string,
	): Promise<ArtifactManifest> {
		try {
			await this.verify(manifest);
		} catch {
			await writeFile(
				join(staging, "manifest.json"),
				JSON.stringify(manifest, null, 2),
				{ mode: 0o600 },
			);
			await rename(staging, directory);
		}
		await this.verify(manifest);
		this.journal.transitionRecord(
			"artifact",
			id,
			"exported",
			"published",
			manifest,
		);
		return manifest;
	}
	private async verify(manifest: ArtifactManifest): Promise<ArtifactManifest> {
		const expected = join(
			resolve(this.artifactsDirectory),
			manifest.artifactId,
			"geometry.3dm",
		);
		if (manifest.path !== expected || manifest.format !== "3dm")
			throw new Error("Artifact path or format mismatch");
		const stat = await lstat(manifest.path);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			checksum(await readFile(manifest.path)) !== manifest.checksum
		)
			throw new Error("Artifact checksum mismatch");
		return manifest;
	}
	async import(input: {
		requestId: string;
		taskId: string;
		artifactId: string;
		destination: TargetBinding;
		destinationUnits: string;
	}): Promise<{
		artifact: ArtifactManifest;
		objectIds: string[];
		operationId: string;
	}> {
		input = structuredClone(input);
		const artifactRecord = this.record("artifact", input.artifactId);
		if (artifactRecord.state !== "published")
			throw new Error("Artifact is not published");
		const snapshot = this.journal.snapshot(),
			task = snapshot.tasks.find((task) => task.id === input.taskId),
			sourceTask = snapshot.tasks.find(
				(task) => task.id === artifactRecord.task_id,
			);
		if (!task || !sourceTask) throw new Error("Artifact task is unavailable");
		const submission = JSON.parse(String(task.payload)) as {
			attachments: unknown[];
		};
		const referenced = submission.attachments.some(
			(attachment) =>
				attachment &&
				typeof attachment === "object" &&
				(attachment as { artifactId?: string }).artifactId === input.artifactId,
		);
		if (
			artifactRecord.task_id !== input.taskId &&
			sourceTask.parent_task_id !== input.taskId &&
			!referenced
		)
			throw new Error("Artifact was not supplied to this task");
		const artifact = await this.verify(
			JSON.parse(String(artifactRecord.payload)) as ArtifactManifest,
		);
		const scale = unitScale(artifact.units, input.destinationUnits),
			id = idFor("import-", input.requestId);
		this.journal.putRecord(
			input.requestId,
			"transfer",
			id,
			input.taskId,
			input,
		);
		const record = this.record("transfer", id);
		if (record.state === "completed") return JSON.parse(String(record.payload));
		if (
			record.state !== "accepted" ||
			this.journal
				.snapshot()
				.operations.some(
					(op) =>
						op.task_id === input.taskId && String(op.arguments).includes(id),
				)
		)
			throw new Error(
				"Import outcome needs reconciliation; automatic replay is disabled",
			);
		return this.scheduler.withProcess(
			input.taskId,
			input.destination,
			async (owner) => {
				await this.verify(artifact);
				const settings = await this.adapter.prepareImport?.(
					owner,
					input.destinationUnits,
				);
				const args = {
					...(settings ?? {}),
					path: artifact.path,
					checksum: artifact.checksum,
					sourceUnits: artifact.units,
					destinationUnits: input.destinationUnits,
					scale,
					artifactId: artifact.artifactId,
				};
				const operation = this.journal.operationIntent({
					taskId: input.taskId,
					turnId: owner.turnId,
					name: "importRhinoArtifact",
					operationClass: "mutation",
					owner,
					arguments: args,
					record: {
						kind: "transfer",
						id,
						expected: "accepted",
						payload: input,
					},
					deadline: Date.now() + 120_000,
				});
				try {
					const result = await this.adapter.import(owner, {
						...args,
						operationId: operation.operationId!,
					});
					this.journal.operationResult(operation.id, "completed", result);
					const receipt = { artifact, ...result, operationId: operation.id };
					this.journal.transitionRecord(
						"transfer",
						id,
						"dispatched",
						"completed",
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
						"transfer",
						id,
						"dispatched",
						error instanceof NativeActionError &&
							["failed", "cancelled"].includes(error.outcome)
							? error.outcome
							: "uncertain",
						{
							artifactId: input.artifactId,
							operationId: operation.id,
							error: String(error),
						},
					);
					throw error;
				}
			},
		);
	}
	private record(kind: string, id: string) {
		const record = this.journal
			.snapshot()
			.records.find((record) => record.kind === kind && record.id === id);
		if (!record) throw new Error("Unknown retained artifact or transfer");
		return record;
	}
}
