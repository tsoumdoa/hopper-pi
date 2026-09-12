import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import type {
	JsonObject,
	OperationName,
	RequestArgsFor,
} from "../../protocol/v2.js";
import type { RpcCallResult } from "../../infra/rpc-client.js";
import type {
	DocumentMetadata,
	DocumentRequest,
} from "../../types/document-management.js";
import { NativeActionError } from "./action-errors.js";
import type { DocumentActionAdapter, DocumentActionRequest } from "./document-actions.js";
import type { TransferAdapter } from "./transfer.js";
import type { SharedNativeRuntime } from "./native-runtime.js";
import { SharedRegistry } from "./registry.js";
import { TaskJournal } from "./journal.js";

function resultData(response: RpcCallResult): any {
	if (response.result.class !== "completed")
		throw new NativeActionError(
			response.result.message ?? "Native operation failed",
			response.result.class === "outcome_unknown"
				? "uncertain"
				: response.result.class === "cancelled_before_start"
					? "cancelled"
					: "failed",
			response,
		);
	const data = "data" in response.result ? response.result.data : undefined;
	if (
		data &&
		typeof data === "object" &&
		!Array.isArray(data) &&
		data.ok === false
	)
		throw new NativeActionError(
			String((data.error as any)?.message ?? "Native action failed"),
			data.outcomeUncertain ? "uncertain" : "failed",
			data,
		);
	return data;
}
/** Parent aliases and existing inode identity cover managed writers through aliases. */
export async function inspectDestination(
	path: string,
): Promise<{ identities: string[]; baseline: unknown; canonicalPath: string }> {
	// Resolve existing aliases without creating directories before native save admission.
	let parent = dirname(resolve(path));
	const suffix = [basename(path)];
	while (true) {
		try {
			parent = await realpath(parent);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const entry = await lstat(parent).catch(cause => {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
				return null;
			});
			// A dangling link is not an absent directory that native code may create.
			if (entry || dirname(parent) === parent) throw error;
			suffix.unshift(basename(parent));
			parent = dirname(parent);
		}
	}
	const canonicalPath = join(parent, ...suffix);
	const casePath =
		process.platform === "win32" || process.platform === "darwin"
			? canonicalPath.toLocaleLowerCase("en-US")
			: canonicalPath;
	try {
		const stat = await lstat(canonicalPath);
		if (!stat.isFile() || stat.isSymbolicLink())
			throw new Error("Save destination must be a regular file");
		return {
			canonicalPath,
			identities: ["path:" + casePath, `file:${stat.dev}:${stat.ino}`],
			baseline: {
				exists: true,
				size: stat.size,
				mtimeMs: stat.mtimeMs,
				device: stat.dev,
				inode: stat.ino,
				checksum: createHash("sha256")
					.update(await readFile(canonicalPath))
					.digest("hex"),
			},
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return {
			canonicalPath,
			identities: ["path:" + casePath],
			baseline: { exists: false },
		};
	}
}
export function createNativeActionAdapters(
	native: SharedNativeRuntime,
	journal: TaskJournal,
	registry: SharedRegistry,
): { documents: DocumentActionAdapter; transfer: TransferAdapter } {
	const inventory = async (grant: DocumentActionRequest) =>
		resultData(
			await native
				.getClient(grant.lifecycleInstanceId)
				.call(
					grant.kind === "rhino"
						? "listRhinoDocuments"
						: "listGrasshopperDocuments",
					{},
				),
		) as {
			documents: DocumentMetadata[];
			activeDocumentId: string | null;
			capabilities: { multiDocument: boolean };
		};
	const transaction = async (
		owner: ExecutionOwner,
		name: OperationName,
		args: JsonObject,
		cleanup = false,
	) => {
		registry.validateBinding(owner);
		const record = journal.operationIntent({
			taskId: owner.taskId,
			turnId: owner.turnId,
			name,
			operationClass: "mutation",
			arguments: args,
			owner,
			cleanup,
			deadline: Date.now() + 30_000,
		});
		try {
			const response = await native
				.getClient(owner.binding.lifecycleInstanceId)
				.call(name, args as RequestArgsFor<typeof name>, {
					executionOwner: owner,
					operationId: record.operationId,
				});
			const data = resultData(response);
			journal.operationResult(record.id, "completed", response);
			return data;
		} catch (error) {
			journal.operationResult(
				record.id,
				error instanceof NativeActionError ? error.outcome : "uncertain",
				{
					error: String(error),
					evidence: error instanceof NativeActionError ? error.evidence : null,
				},
			);
			throw error;
		}
	};
	const confirmIdle = async (owner: ExecutionOwner) => {
		const client = native.getClient(owner.binding.lifecycleInstanceId);
		for (const kind of ["rhino", "grasshopper"] as const) {
			const state = resultData(
				await client.call("getDocumentTransactionState", { owner: kind }),
			);
			if (state?.state !== "idle")
				throw new NativeActionError(
					"Native action cleanup is unconfirmed",
					"uncertain",
					{ kind, state },
				);
		}
	};
	return {
		documents: {
			preflight: async (grant) => {
				native.pruneDeadAttachments();
				if (grant.kind === "grasshopper")
					await native.ensureGrasshopperReadyForDocumentAction(grant.lifecycleInstanceId);
				// Startup can create an untitled canvas; capture capabilities and handles afterwards.
				const state = await inventory(grant);
				if (
					!Array.isArray(state.documents) ||
					typeof state.capabilities?.multiDocument !== "boolean"
				)
					throw new Error("Native document capabilities unavailable");
				const active = state.documents.find(
					(document) => document.documentId === state.activeDocumentId,
				);
				const already =
					grant.action === "open" &&
					state.documents.some(
						(document) =>
							document.path && resolve(document.path) === resolve(grant.path!),
					);
				const affected =
					!state.capabilities.multiDocument && !already && active
						? [active]
						: [];
				const args: DocumentRequest = {
					action: grant.action,
					expectedActiveDocument: state.activeDocumentId ?? null,
					...(grant.path ? { path: grant.path } : {}),
					...(grant.templatePath ? { templatePath: grant.templatePath } : {}),
					...(grant.createDirectories !== undefined ? { createDirectories: grant.createDirectories } : {}),
				};
				const destinations: { identity: string; baseline: unknown }[] = [],
					baselines: { path: string; baseline: unknown }[] = [];
				args.affectedDocuments = [];
				args.expectedDestinations = [];
				for (const document of affected) {
					if (document.isModified && grant.modifiedPolicy === "refuse")
						throw new Error(
							"The replaced document has unsaved changes; ask the user whether to save or discard, then retry with onUnsaved",
						);
					if (document.isModified && grant.modifiedPolicy === "save") {
						const path = grant.savePath ?? document.path;
						if (!path)
							throw new Error("Unsaved model requires an explicit save path");
						const inspected = await inspectDestination(path);
						const baseline = inspected.baseline as { exists: boolean };
						if (baseline.exists && document.path !== path && !grant.overwrite)
							throw new Error(
								"Save destination exists and overwrite is not authorized",
							);
						for (const attachment of registry.list()) {
							if (
								attachment.lifecycleInstanceId === grant.lifecycleInstanceId ||
								attachment.admission === "detached"
							)
								continue;
							const other = resultData(
								await native
									.getClient(attachment.lifecycleInstanceId)
									.call(
										grant.kind === "rhino"
											? "listRhinoDocuments"
											: "listGrasshopperDocuments",
										{},
									),
							);
							for (const candidate of other.documents ?? [])
								if (candidate.path) {
									const otherFile = await inspectDestination(candidate.path);
									if (
										otherFile.identities.some((identity) =>
											inspected.identities.includes(identity),
										)
									)
										throw new Error(
											"Save destination is open in another Rhino process",
										);
								}
						}
						for (const identity of inspected.identities)
							destinations.push({ identity, baseline: inspected.baseline });
						baselines.push({ path, baseline: inspected.baseline });
						const expected = inspected.baseline as {
							exists: boolean;
							size?: number;
							checksum?: string;
						};
						args.expectedDestinations.push({
							path: inspected.canonicalPath,
							exists: expected.exists,
							...(expected.exists
								? { byteLength: expected.size!, sha256: expected.checksum! }
								: {}),
						});
					}
					args.affectedDocuments.push({
						documentId: document.documentId,
						expectedStateToken: document.stateToken,
						onUnsaved:
							grant.modifiedPolicy === "refuse" ? "fail" : grant.modifiedPolicy,
						...(grant.savePath ? { savePath: grant.savePath } : {}),
						overwrite: grant.overwrite ?? false,
						createDirectories: grant.createDirectories ?? false,
					});
				}
				return { destinations, arguments: args, baselines };
			},
			execute: async (owner, grant, operationId, preparation) => {
				if (!preparation.arguments) throw new Error("Document action was not preflighted");
				for (const baseline of preparation.baselines ?? [])
					if (
						JSON.stringify(
							(await inspectDestination(baseline.path)).baseline,
						) !== JSON.stringify(baseline.baseline)
					)
						throw new NativeActionError(
							"Save destination changed after reservation",
							"failed",
							{ path: baseline.path },
						);
				const response = await native
					.getClient(grant.lifecycleInstanceId)
					.call(
						grant.kind === "rhino"
							? "manageRhinoDocument"
							: "manageGrasshopperDocument",
						preparation.arguments,
						{ documentActionOwner: owner, operationId },
					);
				const data = resultData(response),
					document = data?.document as DocumentMetadata | undefined;
				if (
					!document ||
					document.lifecycleInstanceId !== grant.lifecycleInstanceId
				)
					throw new NativeActionError(
						"Document action did not return a verified document",
						"uncertain",
						data,
					);
				const binding: TargetBinding =
					grant.kind === "rhino"
						? {
								kind: "rhino",
								lifecycleInstanceId: grant.lifecycleInstanceId,
								rhinoDocumentId: document.documentId,
							}
						: {
								kind: "grasshopper",
								lifecycleInstanceId: grant.lifecycleInstanceId,
								grasshopperDocumentId: document.documentId,
								associatedRhinoDocumentId:
									document.settings?.associatedRhinoDocumentId ?? null,
							};
				await native.refresh();
				return { binding, result: data };
			},
			verify: async (binding, grant) => {
				registry.resolveBinding(binding);
				if (grant.action === "open") {
					const document = (await inventory(grant)).documents.find(
						(document) =>
							document.documentId ===
							(binding.kind === "rhino"
								? binding.rhinoDocumentId
								: binding.grasshopperDocumentId),
					);
					if (
						!document?.path ||
						(await realpath(document.path)) !== (await realpath(grant.path!))
					)
						throw new Error("Opened document path does not match the request");
				}
			},
		},
		transfer: {
			export: async (owner, input) => {
				registry.validateBinding(owner);
				await native.activateBinding(owner);
				return resultData(
					await native
						.getClient(owner.binding.lifecycleInstanceId)
						.call(
							"exportRhinoArtifact",
							{ path: input.path, objectIds: input.objectIds },
							{ executionOwner: owner, operationId: input.operationId },
						),
				);
			},
			prepareImport: async (owner, destinationUnits) => {
				registry.validateBinding(owner);
				await native.activateBinding(owner);
				if (owner.binding.kind !== "rhino")
					throw new Error(
						"Artifact destination requires a Rhino model binding",
					);
				const settings = resultData(
					await native
						.getClient(owner.binding.lifecycleInstanceId)
						.call(
							"getRhinoDocumentSettings",
							{ documentId: owner.binding.rhinoDocumentId },
							{ executionOwner: owner },
						),
				);
				if (
					typeof settings?.settingsRevision !== "string" ||
					String(settings.model?.units?.name).toLowerCase() !==
						destinationUnits.toLowerCase()
				)
					throw new Error("Destination unit settings changed");
				return { expectedSettingsRevision: settings.settingsRevision };
			},
			import: async (owner, input) => {
				registry.validateBinding(owner);
				if (owner.binding.kind !== "rhino")
					throw new Error(
						"Artifact destination requires a Rhino model binding",
					);
				const client = native.getClient(owner.binding.lifecycleInstanceId);
				const settings = resultData(
					await client.call(
						"getRhinoDocumentSettings",
						{ documentId: owner.binding.rhinoDocumentId },
						{ executionOwner: owner },
					),
				);
				if (
					typeof input.expectedSettingsRevision !== "string" ||
					settings?.settingsRevision !== input.expectedSettingsRevision ||
					String(settings.model?.units?.name).toLowerCase() !==
						input.destinationUnits.toLowerCase()
				)
					throw new Error("Destination unit settings changed");
				await transaction(owner, "beginRhinoAgentTransaction", {
					name: "Hopper geometry import",
				});
				let imported: any = null,
					failed: unknown = null;
				try {
					imported = resultData(
						await client.call(
							"importRhinoArtifact",
							{
								path: input.path,
								checksum: input.checksum,
								sourceUnits: input.sourceUnits,
								destinationUnits: input.destinationUnits,
								scale: input.scale,
								artifactId: input.artifactId,
								expectedSettingsRevision: settings.settingsRevision,
							},
							{ executionOwner: owner, operationId: input.operationId },
						),
					);
				} catch (error) {
					failed = error;
				}
				try {
					const segment = resultData(
						await client.call("getDocumentTransactionState", {
							owner: "rhino",
						}),
					);
					await transaction(
						owner,
						failed
							? "cancelRhinoAgentTransaction"
							: "commitRhinoAgentTransaction",
						{ expectedSegment: segment },
						true,
					);
					await confirmIdle(owner);
				} catch (error) {
					journal.markScopeUncertain(owner, owner.taskId, owner.turnId, {
						error: String(error),
					});
					throw new NativeActionError(
						"Geometry import cleanup requires recovery",
						imported ? "completed" : "uncertain",
						{
							imported,
							importError: failed ? String(failed) : null,
							cleanupError: String(error),
						},
					);
				}
				if (failed) throw failed;
				return imported;
			},
		},
	};
}
