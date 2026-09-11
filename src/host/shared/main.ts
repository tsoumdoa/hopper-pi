import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HostConfig } from "../config.js";
import type { EmbeddedPiHost } from "../pi-runtime.js";
import { sharedToolSettings } from "./tool-settings.js";
import { createHostShutdown, monitorHostLifetime } from "./lifetime.js";
import { SharedHostControl } from "./control.js";
import { TaskJournal } from "./journal.js";
import { SharedTaskService } from "./task-service.js";
import { SharedRegistry } from "./registry.js";
import { SharedBackend } from "./backend.js";
import { createSharedBrowserServer } from "./browser-server.js";
import type { SharedNativeRuntime } from "./native-runtime.js";
import { SharedRecoveryService } from "./recovery.js";
import { DocumentActionService } from "./document-actions.js";
import type { RhinoLaunchService } from "./rhino-launch.js";
import { GeometryTransferService } from "./transfer.js";
import { createNativeActionAdapters } from "./native-actions.js";
import { validateTargetBinding } from "../../protocol/shared-execution.js";
import { loadStartupSources } from "../startup-sources.js";
import { hostProjectRoot } from "../runtime-paths.js";

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
): Promise<void> {
	const startupStartedAt = performance.now();
	const startupCpu = process.cpuUsage();
	const startupStage = (stage: string) => {
		const cpu = process.cpuUsage(startupCpu);
		process.stderr.write(`[shared-host] ${new Date().toISOString()} startup: ${stage} (${Math.round(performance.now() - startupStartedAt)} ms elapsed); ${Math.round((cpu.user + cpu.system) / 1000)} ms CPU\n`);
	};
	startupStage("initializing control");
	process.stderr.write(`[shared-host] Runtime ${process.version} (${process.execPath}); process age ${Math.round(process.uptime() * 1000)} ms\n`);
	const control = new SharedHostControl();
	const dataDirectory = args.includes("--data-dir")
		? join(config.paths.dataDir, "shared-host")
		: undefined;
	const initialize = {
		defaultDataDirectory: join(config.paths.dataDir, "shared-host"),
		dataDirectory,
		explicitStart: args.includes("--explicit-start"),
	};
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
	let documents: DocumentActionService | undefined;
	let launches: RhinoLaunchService | undefined;
	let transfers: GeometryTransferService | undefined;
	let refresh: ReturnType<typeof setInterval> | undefined;
	let stopLifetimeMonitor: (() => void) | undefined;
	let refreshWork: Promise<void> | undefined;
	let closing = false;
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
				if (!backend) throw new Error("Host is initializing");
				const unsubscribe = backend.subscribe(listener);
				listeners.add(listener);
				return () => { unsubscribe(); listeners.delete(listener); };
			},
		},
		browserCredential: state.browserCredential,
		registrationCredential: registrationToken,
		staticDir: config.paths.staticDir,
		uiRuntime: () => admin,
		tools: query => {
			if (!admin || !tasks || !native) throw new Error("Host is initializing");
			return sharedToolSettings(query, { admin, tasks, checkConnection: binding => native!.checkToolConnection(binding) });
		},
		exportConversation: (conversationId) => {
			if (!backend) throw new Error("Host is initializing");
			return backend.exportConversation(conversationId);
		},
		allowedDevOrigin: config.uiDevOrigin,
		onRegistrationError: (error) =>
			process.stderr.write(
				`[shared-host] Registration failed: ${error instanceof Error ? error.message : "Unknown registration failure"}\n`,
			),
		health: () => ({ ...discovery, registrationToken: undefined, listening: !closing, ready: Boolean(backend && !closing) }),
		register: async (request) => {
			if (closing)
				throw new Error("Host is stopping; registrations are closed");
			if (!native || !backend) throw new Error("Host is initializing");
			const result = await native.register(request);
			backend.publish();
			tasks!.pump();
			return {
				...result,
				url: `http://127.0.0.1:${state.endpointPort}/#${state.browserCredential}`,
			};
		},
	});
	const shutdown = createHostShutdown({
		exit: code => process.exit(code || (Number(process.exitCode) || 0)),
		log: message => process.stderr.write(`[shared-host] ${message}\n`),
		cleanup: async () => {
			backend?.stopAdmission();
			stopLifetimeMonitor?.();
			if (refresh) clearInterval(refresh);
			await tasks?.stop();
			await refreshWork?.catch(() => {});
			await native?.close();
			backend?.dispose();
			await admin?.dispose();
			await browser.close();
			journal?.close();
		},
	});
	const close = () => {
		closing = true;
		return shutdown();
	};
	let releaseStartupSources = () => {};
	try {
		await control.acquireOwnership(browser.server, state.revision);
		await control.publish(discovery);
		startupStage("browser listening; loading runtime modules");
		releaseStartupSources = await loadStartupSources(hostProjectRoot());
		// Serve the loading UI before importing and initializing the AI runtime.
		// The short-lived --ensure-host launcher never loads these modules.
		const [{ EmbeddedPiHost }, { createPiTaskDriver }, { Type },
			{ collectDelegationResults, delegationBindingSchema, selectDelegationImages },
			{ SharedNativeRuntime }, { RhinoLaunchService }, { admitDocumentTool }] = await Promise.all([
			import("../pi-runtime.js"), import("./pi-driver.js"), import("@earendil-works/pi-ai"),
			import("./delegation.js"), import("./native-runtime.js"), import("./rhino-launch.js"),
			import("./document-tool-policy.js"),
		]);
		startupStage("opening journal and rebuilding browser history if needed");
		journal = new TaskJournal(join(state.dataDirectory, "journal.sqlite"));
		if (journal.identity !== state.journalIdentity)
			throw new Error(
				"Pinned journal identity does not match the shared database",
			);
		startupStage("recovering journal");
		journal.recover();
		const registry = new SharedRegistry(journal);
		launches = new RhinoLaunchService(journal, registry, { allowsLaunch: async () => {
			const intent = await control.snapshot();
			return !closing && intent?.desiredState === "running" && intent.revision === state.revision;
		} });
		native = new SharedNativeRuntime(epoch, registry, journal);
		startupStage("initializing agent");
		admin = await EmbeddedPiHost.create({
			// Native connections belong to registered attachments and task sessions.
			// Probing the default profile here can wait on a stale Rhino process.
			probeBackend: false,
			paths: {
				...config.paths,
				dataDir: state.dataDirectory,
				sessionsDir: join(state.dataDirectory, "admin", "sessions"),
				workspaceDir: join(state.dataDirectory, "admin", "workspace"),
				scriptWorkspaceDir: join(state.dataDirectory, "admin", "scripts"),
			},
		});
		releaseStartupSources();
		startupStage("restoring task service");
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
					toolConfigDir: config.paths.toolConfigDir,
					model: admin!.snapshot().model,
					thinkingLevel: admin!.snapshot().thinkingLevel,
					skillDataDirectory: state.dataDirectory,
					geometry: (context) => native!.geometry(context),
					...(context.parentTaskId === null
						? {
								documentActions: {
									prepare: (toolCallId, kind, request) => documents!.prepareForTask(context, toolCallId, kind, request),
								},
							}
						: {}),
					delegationTools: (context) => context.parentTaskId === null ? [
						...launches!.tools(context),
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
								"Start a child agent for an accessible document and return immediately. Independent children run concurrently; omit dependencies unless another child's result is required. Native tools sharing a Rhino process take turns.",
							parameters: Type.Object({
								requestId: Type.String(),
								assignment: Type.String(),
								binding: delegationBindingSchema,
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
								"After submitting all independent assignments, wait for delegated tasks and inspect their attributed results, artifacts and failures before writing the combined response.",
							parameters: Type.Object({}),
							execute: async () => {
								await tasks!.waitForChildren(context.taskId);
								return collectDelegationResults(
									journal!.delegationSnapshot(context.taskId),
									context.taskId,
								);
							},
						},
					] : [],
					coordinatorTools: (context) => [
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
		documents = new DocumentActionService(journal, tasks, adapters.documents, kind => admitDocumentTool(kind, config.paths.toolConfigDir));
		transfers = new GeometryTransferService(
			journal,
			tasks,
			join(state.dataDirectory, "artifacts"),
			adapters.transfer,
		);
		tasks.setDocumentActionExecutor((grantId) => documents!.execute(grantId));
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
				recover: (requestId, taskId, acknowledgement) =>
					recovery.recover(requestId, taskId, acknowledgement),
			},
			epoch,
		);
		let refreshing = false;
		stopLifetimeMonitor = monitorHostLifetime({
			shouldStop: () => !closing && !launches!.pending && native!.shouldStopAfterRhinoExit(),
			close,
			log: message => process.stdout.write(`[shared-host] ${message}\n`),
		});
		refresh = setInterval(() => {
			if (refreshing || closing) return;
			refreshing = true;
			refreshWork = Promise.all([native!.refresh(), admin!.refreshAuth()])
				.then(async () => {
					if (closing) return;
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
		process.once("SIGINT", () => {
			void close();
		});
		process.once("SIGTERM", () => {
			void close();
		});
		tasks.pump();
		startupStage("ready");
		process.stdout.write(
			`${JSON.stringify({ type: "ready", mode: "shared", url: `http://127.0.0.1:${state.endpointPort}/`, pid: process.pid })}\n`,
		);
	} catch (error) {
		process.stderr.write(`[shared-host] Startup failed: ${String(error)}\n`);
		// Report failed startup even when its cleanup succeeds.
		process.exitCode = 1;
		await close();
		throw error;
	} finally {
		releaseStartupSources();
	}
}
