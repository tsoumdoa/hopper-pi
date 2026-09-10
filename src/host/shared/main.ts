import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HostConfig } from "../config.js";
import { EmbeddedPiHost } from "../pi-runtime.js";
import { SharedHostControl } from "./control.js";
import { ensureSharedHost } from "./ensure-host.js";
import { TaskJournal } from "./journal.js";
import { SharedTaskService } from "./task-service.js";
import { SharedRegistry } from "./registry.js";
import { SharedBackend } from "./backend.js";
import { createPiTaskDriver } from "./pi-driver.js";
import { createSharedBrowserServer } from "./browser-server.js";
import { SharedNativeRuntime } from "./native-runtime.js";
import { Type } from "@earendil-works/pi-ai";
import { SharedRecoveryService } from "./recovery.js";
import { DocumentGrantService } from "./grants.js";
import { GeometryTransferService } from "./transfer.js";
import {
	collectDelegationResults,
	selectDelegationImages,
} from "./delegation.js";
import { createNativeActionAdapters } from "./native-actions.js";
import { createLaunchCoordinator } from "./launch-coordinator.js";
import { validateTargetBinding } from "../../protocol/shared-execution.js";

function sharedLimit(name: string, fallback: number): number {
	const value =
		process.env[name] === undefined ? fallback : Number(process.env[name]);
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

export async function startSharedHost(
	config: HostConfig,
	args: string[],
	entrypoint: string,
): Promise<void> {
	if (
		args.includes("--parent-pid") ||
		args.includes("--instance-id") ||
		args.includes("--connection-profile")
	)
		throw new Error(
			"Hopper uses one persistent host; per-process host options are no longer supported",
		);
	const control = new SharedHostControl();
	const dataDirectory = args.includes("--data-dir")
		? join(config.paths.dataDir, "shared-host")
		: undefined;
	const initialize = {
		defaultDataDirectory: join(config.paths.dataDir, "shared-host"),
		dataDirectory,
		explicitStart: args.includes("--explicit-start"),
	};
	if (args.includes("--ensure-host")) {
		const forwarded = args.filter(
			(arg) => !["--ensure-host", "--explicit-start"].includes(arg),
		);
		const discovery = await ensureSharedHost({
			control,
			...initialize,
			entrypoint,
			hostArguments: forwarded,
		});
		process.stdout.write(
			`${JSON.stringify({ type: "shared_ready", hostEpoch: discovery.hostEpoch, port: discovery.endpointPort })}\n`,
		);
		return;
	}
	const state = await control.initialize(initialize);
	if (state.desiredState !== "running")
		throw new Error(
			"Shared host is intentionally stopped. Run HopperCode explicitly to restart it",
		);
	const epoch = randomUUID(),
		registrationToken = randomBytes(32).toString("hex");
	// Acquire the singleton endpoint before loading runtimes, recovering tasks or publishing anything.
	let backend: SharedBackend | undefined;
	let journal: TaskJournal | undefined;
	let admin: EmbeddedPiHost | undefined;
	let native: SharedNativeRuntime | undefined;
	let tasks: SharedTaskService | undefined;
	let documents: DocumentGrantService | undefined;
	let transfers: GeometryTransferService | undefined;
	let launches: Awaited<ReturnType<typeof createLaunchCoordinator>> | undefined;
	let refresh: ReturnType<typeof setInterval> | undefined;
	let refreshWork: Promise<void> | undefined;
	let closing: Promise<void> | undefined;
	const discovery = {
		hostEpoch: epoch,
		pid: process.pid,
		processStartIdentity: new Date(
			Date.now() - process.uptime() * 1000,
		).toISOString(),
		protocolVersion: 2,
		schemaVersion: 2,
		journalSchemaVersion: TaskJournal.schemaVersion,
		registrationToken,
		endpointPort: state.endpointPort,
		dataDirectory: state.dataDirectory,
		journalIdentity: state.journalIdentity,
		revision: state.revision,
	};
	const listeners = new Set<(event: unknown) => void>();
	const browser = createSharedBrowserServer({
		backend: {
			snapshot: () => {
				if (!backend) throw new Error("Host is initializing");
				return backend.snapshot();
			},
			command: (command) => {
				if (!backend) return Promise.reject(new Error("Host is initializing"));
				return backend.command(command);
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		browserCredential: state.browserCredential,
		registrationCredential: registrationToken,
		staticDir: config.paths.staticDir,
		uiRuntime: () => admin,
		exportConversation: (conversationId) => {
			if (!backend) throw new Error("Host is initializing");
			return backend.exportConversation(conversationId);
		},
		allowedDevOrigin: config.uiDevOrigin,
		onRegistrationError: (error) =>
			process.stderr.write(
				`[shared-host] Registration failed: ${error instanceof Error ? error.message : "Unknown registration failure"}\n`,
			),
		health: () =>
			backend
				? { ...discovery, registrationToken: undefined, ready: true }
				: { ready: false },
		register: async (request) => {
			if (closing)
				throw new Error("Host is stopping; registrations are closed");
			if (!native || !backend) throw new Error("Host is initializing");
			const result = await native.register(request);
			if (launches) await launches.registered(request, result);
			backend.publish();
			tasks!.pump();
			return {
				...result,
				url: `http://127.0.0.1:${state.endpointPort}/#${state.browserCredential}`,
			};
		},
	});
	const close = () =>
		(closing ??= (async () => {
			backend?.stopAdmission();
			if (refresh) clearInterval(refresh);
			await tasks?.stop();
			await backend?.drainAdmissions();
			await refreshWork?.catch(() => {});
			await native?.close();
			backend?.dispose();
			await admin?.dispose();
			await browser.close();
			journal?.close();
		})());
	try {
		await control.acquireOwnership(browser.server, state.revision);
		journal = new TaskJournal(join(state.dataDirectory, "journal.sqlite"));
		if (journal.identity !== state.journalIdentity)
			throw new Error(
				"Pinned journal identity does not match the shared database",
			);
		journal.recover();
		const registry = new SharedRegistry(journal);
		native = new SharedNativeRuntime(epoch, registry, journal);
		admin = await EmbeddedPiHost.create({
			paths: {
				...config.paths,
				dataDir: state.dataDirectory,
				sessionsDir: join(state.dataDirectory, "admin", "sessions"),
				workspaceDir: join(state.dataDirectory, "admin", "workspace"),
				scriptWorkspaceDir: join(state.dataDirectory, "admin", "scripts"),
			},
		});
		tasks = new SharedTaskService(journal, {
			resolveBinding: (binding) => registry.resolveBinding(binding),
			resolveLifecycle: (lifecycleId) => registry.resolveLifecycle(lifecycleId),
			validateBinding: (owner) => registry.validateBinding(owner),
			maxWorkers: sharedLimit("HOPPER_SHARED_MAX_WORKERS", 4),
			maxCoordinators: sharedLimit("HOPPER_SHARED_MAX_COORDINATORS", 4),
			maxUsage: sharedLimit("HOPPER_SHARED_MAX_TOKENS", 1_000_000),
			createDriver: (context) =>
				createPiTaskDriver(context, {
					dataDirectory: state.dataDirectory,
					authPath: config.paths.authPath,
					model: admin!.snapshot().model,
					thinkingLevel: admin!.snapshot().thinkingLevel,
					skillDataDirectory: state.dataDirectory,
					geometry: (context) => native!.geometry(context),
					...(journal!
						.snapshot()
						.tasks.find((task) => task.id === context.taskId)
						?.parent_task_id === null
						? {
								documentActions: {
									list: () =>
										journal!
											.snapshot()
											.records.filter(
												(record) =>
													record.task_id === context.taskId &&
													record.kind === "grant" &&
													JSON.parse(String(record.payload)).action,
											),
									execute: (grantId: string) => documents!.execute(grantId),
								},
							}
						: {}),
					delegationTools: (context) => context.parentTaskId === null ? [
						{
							name: "listRhinoTargets",
							label: "Rhino targets",
							description:
								"List connected Hopper Code instances and documents accessible to this message.",
							parameters: Type.Object({}),
							execute: async () => ({
								content: [
									{ type: "text", text: JSON.stringify(registry.accessibleTargets([...(context.accessibleBindings ?? []), ...journal!.authorizationAdditions(context.taskId)])) },
								],
								details: {},
							}),
						},
						{
							name: "delegate",
							label: "Delegate to a target",
							description:
								"Read or edit an accessible document in a child task. Dependencies must complete first.",
							parameters: Type.Object({
								requestId: Type.String(),
								assignment: Type.String(),
								binding: Type.Unknown(),
								dependencies: Type.Optional(Type.Array(Type.String())),
								attachmentIndices: Type.Optional(
									Type.Array(Type.Integer({ minimum: 0 }), {
										description:
											"Optional zero-based indices of parent image attachments; defaults to all supplied images.",
									}),
								),
							}),
							execute: async (_id, raw) => {
								const input = raw as {
									requestId: string;
									assignment: string;
									binding: unknown;
									dependencies?: string[];
									attachmentIndices?: number[];
								};
								const binding = validateTargetBinding(input.binding);
								if (!binding.ok) throw new Error(binding.errors.join("; "));
								const receipt = tasks!.delegate({
									requestId: input.requestId,
									conversationId: context.conversationId,
									sessionId: `worker-${createHash("sha256").update(`${context.taskId}:${input.requestId}`).digest("hex").slice(0, 32)}`,
									parentTaskId: context.taskId,
									dependencies: input.dependencies ?? [],
									kind: "prompt",
									text: input.assignment,
									bindings: [binding.value],
									attachments: selectDelegationImages(
										context.attachments,
										input.attachmentIndices,
									),
								});
								return {
									content: [{ type: "text", text: JSON.stringify(receipt) }],
									details: receipt,
								};
							},
						},
						{
							name: "waitForDelegates",
							label: "Collect child results",
							description:
								"Wait for delegated tasks and inspect their attributed results, artifacts and failures before writing the combined response.",
							parameters: Type.Object({}),
							execute: async () => {
								await tasks!.waitForChildren(context.taskId);
								return collectDelegationResults(
									journal!.snapshot(),
									context.taskId,
								);
							},
						},
					] : [],
					coordinatorTools: (context) => [
						...(launches?.tools(context) ?? []),
						{
							name: "exportRhinoGeometry",
							label: "Export geometry artifact",
							description:
								"Export selected source Rhino objects into an immutable native .3dm artifact.",
							parameters: Type.Object({
								requestId: Type.String(),
								source: Type.Unknown(),
								objectIds: Type.Array(Type.String()),
							}),
							execute: async (_id, raw) => {
								const args = raw as {
									requestId: string;
									source: unknown;
									objectIds: string[];
								};
								const source = validateTargetBinding(args.source);
								if (!source.ok) throw new Error("Invalid source binding");
								const result = await transfers!.export({
									requestId: args.requestId,
									taskId: context.taskId,
									source: source.value,
									objectIds: args.objectIds,
								});
								return {
									content: [{ type: "text", text: JSON.stringify(result) }],
									details: {},
								};
							},
						},
						{
							name: "importRhinoGeometry",
							label: "Import geometry artifact",
							description:
								"Import a published artifact into an authorized target, preserving physical dimensions and assigning new object IDs.",
							parameters: Type.Object({
								requestId: Type.String(),
								artifactId: Type.String(),
								destination: Type.Unknown(),
								destinationUnits: Type.String(),
							}),
							execute: async (_id, raw) => {
								const args = raw as {
									requestId: string;
									artifactId: string;
									destination: unknown;
									destinationUnits: string;
								};
								const destination = validateTargetBinding(args.destination);
								if (!destination.ok)
									throw new Error("Invalid destination binding");
								const result = await transfers!.import({
									requestId: args.requestId,
									taskId: context.taskId,
									artifactId: args.artifactId,
									destination: destination.value,
									destinationUnits: args.destinationUnits,
								});
								return {
									content: [{ type: "text", text: JSON.stringify(result) }],
									details: {},
								};
							},
						},
					],
				}),
		});
		const adapters = createNativeActionAdapters(native, journal, registry);
		documents = new DocumentGrantService(journal, tasks, adapters.documents);
		transfers = new GeometryTransferService(
			journal,
			tasks,
			join(state.dataDirectory, "artifacts"),
			adapters.transfer,
		);
		tasks.setDocumentActionExecutor((grantId) => documents!.execute(grantId));
		launches = await createLaunchCoordinator({
			journal,
			control,
			registry,
			documentActions: documents,
		});
		const recovery = new SharedRecoveryService(
			journal,
			registry,
			tasks,
			native,
		);
		backend = new SharedBackend(
			tasks,
			registry,
			admin,
			async () => {
				const current = await control.snapshot();
				if (!current) throw new Error("Missing host intent");
				await control.setDesiredState("stopped", current.revision);
				setImmediate(() => {
					void close();
				});
			},
			{
				authorizeDocument: async (taskId, command) => {
					const action = command.documentAction!;
					registry.resolveLifecycle(action.lifecycleInstanceId);
					documents!.authorize({
						requestId: `${command.requestId}:document`,
						taskId,
						...action,
					});
				},
				authorizeLaunch: async (taskId, command) => {
					await launches!.authorize({
						requestId: `${command.requestId}:launch`,
						rootTaskId: taskId,
						...command.launch!,
					});
				},
				installations: () => launches!.installations(),
				recoverLaunch: (requestId, taskId, launchRequestId, acknowledgement) =>
					launches!.recoverLaunch({
						requestId,
						taskId,
						launchRequestId,
						acknowledgement,
					}),
				recover: (requestId, taskId, acknowledgement) =>
					recovery.recover(requestId, taskId, acknowledgement),
			},
			epoch,
		);
		backend.subscribe((event) => {
			for (const listener of listeners) listener(event);
		});
		let refreshing = false;
		refresh = setInterval(() => {
			if (refreshing || closing) return;
			refreshing = true;
			refreshWork = Promise.all([native!.refresh(), admin!.refreshAuth()])
				.then(async () => {
					if (closing) return;
					await launches!.refresh();
					await backend!.resumeAdmissions();
					if (closing) return;
					backend!.publish();
					tasks!.pump();
				})
				.catch((error) => {
					if (!closing)
						for (const listener of listeners)
							listener({
								type: "error",
								message: `Shared host refresh failed: ${error instanceof Error ? error.message : String(error)}`,
							});
				})
				.finally(() => {
					refreshing = false;
				});
		}, 3000);
		await control.publish(discovery);
		process.once("SIGINT", () => {
			void close();
		});
		process.once("SIGTERM", () => {
			void close();
		});
		await backend.resumeAdmissions();
		tasks.pump();
		process.stdout.write(
			`${JSON.stringify({ type: "ready", mode: "shared", url: `http://127.0.0.1:${state.endpointPort}/`, pid: process.pid })}\n`,
		);
	} catch (error) {
		await close();
		throw error;
	}
}
