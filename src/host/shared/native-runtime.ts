import { isAbsolute } from "node:path";
import {
	resolveConnection,
	type ConnectionConfig,
} from "../../infra/connection.js";
import { RuntimeSessionContext } from "../../infra/runtime-session-context.js";
import {
	HopperRpcClient,
	type RpcCallOptions,
	type RpcCallResult,
} from "../../infra/rpc-client.js";
import {
	beginRuntimeAgentTurn,
	commitRuntimeAgentTurn,
	closeRuntimeRpc,
	RuntimeRpc,
	type RuntimeRpcTransport,
} from "../../infra/runtime-rpc.js";
import { SubscriberStatusEventSource } from "../../infra/status-event-source.js";
import {
	classifyOperation,
	type OperationName,
	type RequestArgsFor,
} from "../../protocol/v2.js";
import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import type { DriverContext } from "./task-service.js";
import { SharedRegistry } from "./registry.js";
import { TaskJournal } from "./journal.js";
import { inspectDestination } from "./native-actions.js";
import type {
	DocumentMetadata,
	DocumentRequest,
} from "../../types/document-management.js";

const inventoryTimeout = { completionTimeoutMs: 3000 };
const processExists = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
};

function data(result: RpcCallResult): any {
	if (result.result.class !== "completed")
		throw new Error(
			result.result.message ??
				`Native operation ${result.operation} returned ${result.result.class}`,
		);
	return "data" in result.result ? result.result.data : undefined;
}
interface Instance {
	connection: ConnectionConfig;
	client: HopperRpcClient;
	generation: string;
}
export class SharedNativeRuntime {
	private readonly registrations = new Map<
		string,
		Promise<{ lifecycleInstanceId: string; attachmentGeneration: string }>
	>();
	private readonly instances = new Map<string, Instance>();
	constructor(
		private readonly epoch: string,
		private readonly registry: SharedRegistry,
		private readonly journal: TaskJournal,
		private readonly isProcessAlive: (pid: number) => boolean = processExists,
	) {}
	async register(
		input: unknown,
	): Promise<{ lifecycleInstanceId: string; attachmentGeneration: string }> {
		const request = input as {
			action?: string;
			lifecycleInstanceId?: string;
			profilePath?: string;
		};
		const key =
			request?.action === "detach"
				? (request.lifecycleInstanceId ?? "invalid")
				: typeof request?.profilePath === "string"
					? new RuntimeSessionContext({
							connectionProfilePath: request.profilePath,
						}).run(() => resolveConnection()).lifecycleInstanceId
					: "invalid";
		const prior = this.registrations.get(key);
		const pending = (prior ?? Promise.resolve())
			.catch(() => {})
			.then(() => this.registerOne(input));
		this.registrations.set(key, pending);
		try {
			return await pending;
		} finally {
			if (this.registrations.get(key) === pending)
				this.registrations.delete(key);
		}
	}
	private async registerOne(
		input: unknown,
	): Promise<{ lifecycleInstanceId: string; attachmentGeneration: string }> {
		if (!input || typeof input !== "object")
			throw new Error("Invalid registration");
		const v = input as {
			profilePath?: string;
			hostEpoch?: string;
			process?: { pid: number; startIdentity: string };
			action?: string;
			lifecycleInstanceId?: string;
		};
		if (v.hostEpoch !== this.epoch)
			throw new Error("Host epoch changed; rediscover the host");
		if (v.action === "detach") {
			const id = v.lifecycleInstanceId ?? "";
			const instance = this.instances.get(id);
			if (instance) {
				this.registry.detach(id);
				this.instances.delete(id);
				await instance.client.close();
			}
			return {
				lifecycleInstanceId: id,
				attachmentGeneration: instance?.generation ?? "",
			};
		}
		if (
			typeof v.profilePath !== "string" ||
			!isAbsolute(v.profilePath) ||
			!v.process ||
			!Number.isSafeInteger(v.process.pid) ||
			v.process.pid < 1 ||
			!v.process.startIdentity
		)
			throw new Error("Registration requires a profile and process identity");
		const context = new RuntimeSessionContext({
			connectionProfilePath: v.profilePath,
		});
		const connection = context.run(() => resolveConnection());
		for (const endpoint of [connection.rpcEndpoint, connection.pubEndpoint])
			if (!/^tcp:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
				throw new Error(
					"Shared attachments must use local loopback transports",
				);
		const existing = this.instances.get(connection.lifecycleInstanceId);
		if (existing && existing.connection.token !== connection.token)
			throw new Error("Lifecycle credential changed");
		const client =
			existing?.client ??
			new HopperRpcClient({
				endpoint: connection.rpcEndpoint,
				lifecycleInstanceId: connection.lifecycleInstanceId,
				token: connection.token,
			});
		try {
			await client.connect();
			const handshake = data(
				await client.call("lifecycleHandshake", {
					nodeProcessId: process.pid,
					nodeVersion: process.version,
					clientIdentity: client.identity,
					hostEpoch: this.epoch,
				}),
			);
			if (typeof handshake?.attachmentGeneration !== "string")
				throw new Error("Plugin does not support shared attachment ownership");
			// A stopped or failed lifecycle may have missed its detach request. An
			// authenticated replacement in that same native process supersedes it.
			for (const previous of this.registry.list()) {
				if (previous.lifecycleInstanceId === connection.lifecycleInstanceId ||
					previous.processId !== v.process.pid ||
					previous.processStartTime !== v.process.startIdentity ||
					previous.admission === "detached") continue;
				this.registry.detach(previous.lifecycleInstanceId);
				const previousInstance = this.instances.get(previous.lifecycleInstanceId);
				this.instances.delete(previous.lifecycleInstanceId);
				await previousInstance?.client.close();
			}
			const instance = {
				connection,
				client,
				generation: handshake.attachmentGeneration,
			};
			this.instances.set(connection.lifecycleInstanceId, instance);
			const attachment = {
				lifecycleInstanceId: connection.lifecycleInstanceId,
				processId: v.process.pid,
				processStartTime: v.process.startIdentity,
				hostEpoch: this.epoch,
				attachmentGeneration: instance.generation,
				capabilities: ["captured-active-document"],
				documents: [] as TargetBinding[],
				admission: "recovering" as const,
				label: `Rhino ${v.process.pid}`,
			};
			this.registry.register(attachment);
			// The plugin cannot finish its lifecycle start until this registration returns.
			// Document inventory and cleanup run on Rhino's UI queue, which may still be starting.
			// Keep admission closed; the regular refresh completes readiness after native startup.
			return {
				lifecycleInstanceId: connection.lifecycleInstanceId,
				attachmentGeneration: instance.generation,
			};
		} catch (error) {
			if (!existing) {
				this.instances.delete(connection.lifecycleInstanceId);
				await client.close();
			}
			throw error;
		}
	}
	private async documents(
		instance: Instance,
	): Promise<{ bindings: TargetBinding[]; labels: Record<string, string> }> {
		const rhino = data(
			await instance.client.call("listRhinoDocuments", {}, inventoryTimeout),
		);
		const grasshopper = data(
			await instance.client.call(
				"listGrasshopperDocuments",
				{},
				inventoryTimeout,
			),
		);
		const list = (value: any): any[] =>
			Array.isArray(value)
				? value
				: Array.isArray(value?.documents)
					? value.documents
					: [];
		return {
			labels: Object.fromEntries(
				[...list(rhino), ...list(grasshopper)].map((document) => [
					document.documentId,
					document.path
						? `${document.name ?? "Untitled"} — ${document.path}`
						: (document.name ?? "Untitled"),
				]),
			),
			bindings: [
				...list(rhino).map((document) => ({
					kind: "rhino" as const,
					lifecycleInstanceId: instance.connection.lifecycleInstanceId,
					rhinoDocumentId: document.documentId,
				})),
				...list(grasshopper).map((document) => ({
					kind: "grasshopper" as const,
					lifecycleInstanceId: instance.connection.lifecycleInstanceId,
					grasshopperDocumentId: document.documentId,
					associatedRhinoDocumentId:
						document.associatedRhinoDocumentId ??
						document.settings?.associatedRhinoDocumentId ??
						null,
				})),
			],
		};
	}
	private async scopes(instance: Instance): Promise<any[]> {
		const rhino = data(
			await instance.client.call(
				"getDocumentTransactionState",
				{ owner: "rhino" },
				inventoryTimeout,
			),
		);
		const grasshopper = data(
			await instance.client.call(
				"getDocumentTransactionState",
				{ owner: "grasshopper" },
				inventoryTimeout,
			),
		);
		return [rhino, grasshopper];
	}
	async geometry(context: DriverContext) {
		if (!context.owner)
			throw new Error("Geometry requires execution ownership");
		const owner = context.owner;
		this.registry.validateBinding(owner);
		await this.activateBinding(owner);
		const instance = this.instances.get(owner.binding.lifecycleInstanceId);
		if (!instance) throw new Error("Lifecycle is detached");
		let blocked = false;
		let paused = false;
		let pauseEvidence: unknown;
		const cleanupNames = new Set([
			"commitAgentTransaction",
			"cancelAgentTransaction",
			"commitRhinoAgentTransaction",
			"cancelRhinoAgentTransaction",
		]);
		const call = async <O extends OperationName>(
			operation: O,
			args: RequestArgsFor<O>,
			options: RpcCallOptions = {},
		): Promise<RpcCallResult> => {
			const cleanup = cleanupNames.has(operation);
			if (paused || (blocked && !cleanup && !["getDocumentTransactionState", "getOperationResult", "getRuntimeStatus", "lifecycleHandshake"].includes(operation)))
				throw new Error("Selected document is paused while delegated tasks run");
			if (
				cleanup ||
				[
					"getDocumentTransactionState",
					"getOperationResult",
					"getRuntimeStatus",
					"lifecycleHandshake",
				].includes(operation)
			) {
				const attachment = this.registry
					.list()
					.find(
						(item) =>
							item.lifecycleInstanceId === owner.binding.lifecycleInstanceId,
					);
				if (
					!attachment ||
					attachment.attachmentGeneration !== owner.attachmentGeneration
				)
					throw new Error("Cleanup owner generation changed");
			} else this.registry.validateBinding(owner);
			if (operation === "lifecycleHandshake")
				return instance.client.call(operation, {
					...args,
					hostEpoch: this.epoch,
				} as RequestArgsFor<O>);
			if (
				context.signal.aborted &&
				!cleanup &&
				classifyOperation(operation) !== "query"
			)
				throw new Error("Task cancellation requested");
			const preparation =
				operation === "manageRhinoDocument" ||
				operation === "manageGrasshopperDocument"
					? await this.prepareBoundDocument(
							owner,
							operation,
							args as DocumentRequest,
						)
					: undefined;
			if (preparation) {
				args = preparation.args as RequestArgsFor<O>;
				this.registry.validateBinding(owner);
			}
			const kind = classifyOperation(operation);
			const record =
				kind === "query"
					? undefined
					: this.journal.operationIntent({
							taskId: context.taskId,
							turnId: context.turnId,
							name: operation,
							operationClass: kind!,
							arguments: args,
							deadline: Date.now() + (options.completionTimeoutMs ?? 8000),
							owner,
							cleanup,
							reservations: preparation?.reservations,
						});
			try {
				const result = await instance.client.call(operation, args, {
					...options,
					...(record?.operationId ? { operationId: record.operationId } : {}),
					executionOwner: owner,
				});
				if (record) {
					const body =
						"data" in result.result
							? (result.result.data as
									| { ok?: boolean; outcomeUncertain?: boolean }
									| undefined)
							: undefined;
					this.journal.operationResult(
						record.id,
						result.result.class === "completed"
							? body?.outcomeUncertain
								? "uncertain"
								: body?.ok === false
									? "failed"
									: "completed"
							: result.result.class === "cancelled_before_start"
								? "cancelled"
								: result.result.class === "outcome_unknown"
									? "uncertain"
									: "failed",
						result,
					);
				}
				return result;
			} catch (error) {
				if (record)
					this.journal.operationResult(record.id, "uncertain", {
						error: String(error),
					});
				throw error;
			}
		};
		const transport: RuntimeRpcTransport = {
			identity: instance.client.identity,
			connect: () => instance.client.connect(),
			call,
			close: async () => {},
		};
		const runtimeSession = new RuntimeSessionContext({
			connection: instance.connection,
			createRuntime: () =>
				new RuntimeRpc({
					lifecycleInstanceId: instance.connection.lifecycleInstanceId,
					transport,
					events: new SubscriberStatusEventSource(
						instance.connection.pubEndpoint,
					),
				}),
		});
		return {
			runtimeSession,
			pause: async () => {
				blocked = true;
				await runtimeSession.run(commitRuntimeAgentTurn);
				// Dispose transaction state before another task uses this process.
				await runtimeSession.run(closeRuntimeRpc);
				const scopes = await this.scopes(instance);
				paused = scopes.every((scope) => scope?.state === "idle");
				pauseEvidence = { scopes };
				return { confirmed: paused, evidence: pauseEvidence };
			},
			resume: async () => {
				if (context.signal.aborted) throw new Error("Task cancelled");
				await this.activateBinding(owner);
				runtimeSession.run(beginRuntimeAgentTurn);
				paused = false;
				blocked = false;
			},
			cleanup: async () => {
				await runtimeSession.run(closeRuntimeRpc);
				if (paused) return { confirmed: true, evidence: pauseEvidence };
				const scopes = await this.scopes(instance);
				return {
					confirmed: scopes.every((scope) => scope?.state === "idle"),
					evidence: { scopes },
				};
			},
		};
	}
	async activateBinding(owner: ExecutionOwner): Promise<void> {
		this.registry.validateBinding(owner);
		const instance = this.instances.get(owner.binding.lifecycleInstanceId);
		if (!instance) throw new Error("Lifecycle is detached");
		const targets =
			owner.binding.kind === "rhino"
				? [{ kind: "rhino" as const, id: owner.binding.rhinoDocumentId }]
				: [
						...(owner.binding.associatedRhinoDocumentId
							? [
									{
										kind: "rhino" as const,
										id: owner.binding.associatedRhinoDocumentId,
									},
								]
							: []),
						{
							kind: "grasshopper" as const,
							id: owner.binding.grasshopperDocumentId,
						},
					];
		for (const target of targets) {
			const list =
				target.kind === "rhino"
					? "listRhinoDocuments"
					: "listGrasshopperDocuments";
			const inventory = data(
				await instance.client.call(list, {}, inventoryTimeout),
			);
			if (inventory.activeDocumentId === target.id) continue;
			const document = (inventory.documents as DocumentMetadata[]).find(
				(item) => item.documentId === target.id,
			);
			if (!document?.stateToken)
				throw new Error("Captured target is unavailable for activation");
			if (
				(await this.scopes(instance)).some((scope) => scope?.state !== "idle")
			)
				throw new Error(
					"Both native scopes must close before captured document activation",
				);
			this.registry.validateBinding(owner);
			const name =
				target.kind === "rhino"
					? "manageRhinoDocument"
					: "manageGrasshopperDocument";
			const args: DocumentRequest = {
				action: "activate",
				documentId: target.id,
				expectedStateToken: document.stateToken,
				expectedActiveDocument: inventory.activeDocumentId ?? null,
				expectedDestinations: [],
			};
			const operation = this.journal.operationIntent({
				taskId: owner.taskId,
				turnId: owner.turnId,
				name,
				operationClass: "mutation",
				arguments: args,
				owner,
				deadline: Date.now() + 8000,
			});
			try {
				const response = await instance.client.call(name, args, {
					executionOwner: owner,
					operationId: operation.operationId,
				});
				const result = data(response);
				if (result?.ok === false) {
					this.journal.operationResult(
						operation.id,
						result.outcomeUncertain ? "uncertain" : "failed",
						response,
					);
					throw new Error(
						`Captured document activation failed: ${JSON.stringify(result.error)}`,
					);
				}
				const verified = data(
					await instance.client.call(list, {}, inventoryTimeout),
				);
				if (verified.activeDocumentId !== target.id)
					throw new Error(
						"Native activation did not retain the captured target",
					);
				if (
					target.kind === "grasshopper" &&
					owner.binding.kind === "grasshopper"
				) {
					const active = (verified.documents as DocumentMetadata[]).find(
						(item) => item.documentId === target.id,
					);
					if (
						(active?.settings?.associatedRhinoDocumentId ?? null) !==
						owner.binding.associatedRhinoDocumentId
					)
						throw new Error(
							"Grasshopper association changed during activation",
						);
				}
				this.journal.operationResult(operation.id, "completed", response);
			} catch (error) {
				const recorded = this.journal
					.snapshot()
					.operations.find((item) => item.id === operation.id);
				if (recorded?.state === "dispatched")
					this.journal.operationResult(operation.id, "uncertain", {
						error: String(error),
					});
				throw error;
			}
		}
	}
	private async prepareBoundDocument(
		owner: ExecutionOwner,
		operation: "manageRhinoDocument" | "manageGrasshopperDocument",
		input: DocumentRequest,
	) {
		if (!["save", "saveAs", "close"].includes(input.action))
			throw new Error(
				"Use a bounded document action through the coordinator for new/open/activation",
			);
		const kind = operation === "manageRhinoDocument" ? "rhino" : "grasshopper";
		const id =
			kind === "rhino"
				? owner.binding.kind === "rhino"
					? owner.binding.rhinoDocumentId
					: owner.binding.associatedRhinoDocumentId
				: owner.binding.kind === "grasshopper"
					? owner.binding.grasshopperDocumentId
					: null;
		if (!id || input.documentId !== id)
			throw new Error("Document action cannot override the captured binding");
		if (!input.expectedStateToken)
			throw new Error("Inspect the bound document before saving or closing it");
		const inventoryOperation =
			kind === "rhino" ? "listRhinoDocuments" : "listGrasshopperDocuments";
		const inventory = data(
			await this.getClient(owner.binding.lifecycleInstanceId).call(
				inventoryOperation,
				{},
				inventoryTimeout,
			),
		);
		const document = (inventory.documents as DocumentMetadata[]).find(
			(document) => document.documentId === id,
		);
		if (!document || document.stateToken !== input.expectedStateToken)
			throw new Error("Bound document changed before action preflight");
		const args: DocumentRequest = { ...input, expectedDestinations: [] };
		const path =
			input.action === "saveAs"
				? input.path
				: input.action === "save"
					? document.path
					: input.onUnsaved === "save" && document.isModified
						? (input.savePath ?? document.path)
						: null;
		const reservations: { identity: string; baseline: unknown }[] = [];
		this.pruneDeadAttachments();
		if ((input.action === "save" || input.action === "saveAs") && !path)
			throw new Error(
				"Unnamed document requires an explicit saveAs destination",
			);
		if (path) {
			if (!isAbsolute(path))
				throw new Error("Save destination must be absolute");
			const inspected = await inspectDestination(path);
			await Promise.all(
				this.registry
					.list()
					.filter(
						(attachment) =>
							attachment.lifecycleInstanceId !==
								owner.binding.lifecycleInstanceId &&
							attachment.admission !== "detached",
					)
					.map(async (attachment) => {
						const other = data(
							await this.getClient(attachment.lifecycleInstanceId).call(
								inventoryOperation,
								{},
								inventoryTimeout,
							),
						);
						for (const candidate of other.documents as DocumentMetadata[])
							if (candidate.path) {
								const aliases = await inspectDestination(candidate.path);
								if (
									aliases.identities.some((identity) =>
										inspected.identities.includes(identity),
									)
								)
									throw new Error(
										"Save destination is open in another Rhino process",
									);
							}
					}),
			);
			const expected = inspected.baseline as {
				exists: boolean;
				size?: number;
				checksum?: string;
			};
			args.expectedDestinations = [
				{
					path: inspected.canonicalPath,
					exists: expected.exists,
					...(expected.exists
						? { byteLength: expected.size!, sha256: expected.checksum! }
						: {}),
				},
			];
			for (const identity of inspected.identities)
				reservations.push({ identity, baseline: inspected.baseline });
		}
		return { args, reservations };
	}
	pruneDeadAttachments(): void {
		for (const attachment of this.registry.list()) {
			if (
				attachment.admission !== "detached" &&
				!this.instances.has(attachment.lifecycleInstanceId) &&
				!this.isProcessAlive(attachment.processId)
			)
				this.registry.detach(attachment.lifecycleInstanceId);
		}
	}
	async refresh(): Promise<void> {
		this.pruneDeadAttachments();
		await Promise.all(
			[...this.instances].map(async ([id, instance]) => {
				const current = () => this.instances.get(id) === instance;
				try {
					const attachment = this.registry
						.list()
						.find((item) => item.lifecycleInstanceId === id)!;
					if (!this.isProcessAlive(attachment.processId)) {
						if (current()) {
							this.registry.detach(id);
							this.instances.delete(id);
							await instance.client.close();
						}
						return;
					}
					const documents = await this.documents(instance);
					if (!current()) return;
					this.registry.updateDocuments(
						id,
						documents.bindings,
						documents.labels,
					);
					if (
						this.registry.list().find((item) => item.lifecycleInstanceId === id)
							?.admission === "recovering"
					) {
						const scopes = await this.scopes(instance);
						if (!current()) return;
						const snapshot = this.journal.snapshot();
						const recovered = new Set(
							snapshot.recoveries.map((recovery) => String(recovery.task_id)),
						);
						const unresolved = snapshot.operations.some(
							(operation) =>
								!recovered.has(String(operation.task_id)) &&
								["dispatched", "uncertain"].includes(String(operation.state)) &&
								(() => {
									try {
										const owner = JSON.parse(String(operation.owner));
										return (
											(owner?.binding?.lifecycleInstanceId ??
												owner?.lifecycleInstanceId) === id
										);
									} catch {
										return false;
									}
								})(),
						);
						if (!unresolved && scopes.every((scope) => scope?.state === "idle"))
							this.registry.markReady(id, {
								authenticated: true,
								generation: instance.generation,
								operationsIdle: true,
								rhinoScopeIdle: true,
								grasshopperScopeIdle: true,
							});
					}
				} catch {
					if (!current()) return;
					const attachment = this.registry
						.list()
						.find((item) => item.lifecycleInstanceId === id);
					if (attachment?.admission === "ready")
						this.registry.register({ ...attachment, admission: "recovering" });
				}
			}),
		);
	}
	async reconcileAttachment(lifecycleId: string): Promise<{
		attachmentGeneration: string;
		operationsIdle: boolean;
		rhinoScopeIdle: boolean;
		grasshopperScopeIdle: boolean;
		evidence: unknown;
	}> {
		const previous = this.instances.get(lifecycleId);
		const attachment = this.registry
			.list()
			.find((item) => item.lifecycleInstanceId === lifecycleId);
		if (!previous || !attachment)
			throw new Error(
				"The original lifecycle must reattach before live recovery",
			);
		this.registry.register({ ...attachment, admission: "recovering" });
		this.instances.delete(lifecycleId);
		await previous.client.close();
		const registration = await this.register({
			profilePath: previous.connection.profilePath,
			hostEpoch: this.epoch,
			process: {
				pid: attachment.processId,
				startIdentity: attachment.processStartTime,
			},
		});
		if (registration.attachmentGeneration === previous.generation)
			throw new Error("Native ownership generation was not fenced");
		const current = this.instances.get(lifecycleId)!;
		const scopes = await this.scopes(current);
		const observations: unknown[] = [];
		let operationsIdle = true;
		for (const operation of this.journal.snapshot().operations) {
			if (!["dispatched", "uncertain"].includes(String(operation.state)))
				continue;
			let owner: any;
			try {
				owner = JSON.parse(String(operation.owner));
			} catch {
				continue;
			}
			if (
				(owner?.binding?.lifecycleInstanceId ?? owner?.lifecycleInstanceId) !==
				lifecycleId
			)
				continue;
			if (!operation.wire_id) continue;
			const result = data(
				await current.client.call("getOperationResult", {
					operationId: String(operation.wire_id),
				}),
			);
			observations.push({ operationId: operation.id, result });
			if (result?.state === "pending" && result.phase === "running")
				operationsIdle = false;
		}
		if (!operationsIdle || scopes.some((scope) => scope?.state !== "idle"))
			this.registry.register({
				...attachment,
				attachmentGeneration: current.generation,
				admission: "recovering",
			});
		return {
			attachmentGeneration: current.generation,
			operationsIdle,
			rhinoScopeIdle: scopes[0]?.state === "idle",
			grasshopperScopeIdle: scopes[1]?.state === "idle",
			evidence: {
				previousGeneration: previous.generation,
				generation: current.generation,
				scopes,
				observations,
			},
		};
	}
	getClient(lifecycleId: string): HopperRpcClient {
		const instance = this.instances.get(lifecycleId);
		if (!instance) throw new Error(`Lifecycle ${lifecycleId} is not attached`);
		return instance.client;
	}
	async close(): Promise<void> {
		const instances = [...this.instances.values()];
		this.instances.clear();
		await Promise.all(instances.map((instance) => instance.client.close()));
	}
}
