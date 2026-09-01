import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthType } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionServicesOptions,
	ModelRuntime,
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import hopperPiExtension from "../index.js";
import hopperChoicesExtension from "../extensions/choices/index.js";
import { serializeAgentEvent, toWireValue } from "./event-serializer.js";
import { HostMessageBus } from "./message-bus.js";
import type { HostPaths } from "./config.js";
import type { HostSnapshot, JsonValue } from "./protocol.js";
import { BrowserUiContext } from "./web-ui-context.js";

export type EmbeddedPiHostOptions = {
	paths: HostPaths;
	projectRoot?: string;
	bus?: HostMessageBus;
	onShutdownRequest?: () => void;
};

function defaultProjectRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function modelSummary(model: { provider: string; id: string; name?: string }) {
	return { provider: model.provider, id: model.id, name: model.name };
}

export function isolatedResourceLoaderOptions(
	projectRoot: string,
): NonNullable<CreateAgentSessionServicesOptions["resourceLoaderOptions"]> {
	return {
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [
			{ name: "hopper", factory: hopperPiExtension },
			{ name: "hopper-choices", factory: hopperChoicesExtension },
		],
		additionalSkillPaths: [
			join(projectRoot, "mds", "skills"),
			join(projectRoot, "mds", "reference"),
		],
	};
}

export class EmbeddedPiHost {
	readonly bus: HostMessageBus;
	readonly ui: BrowserUiContext;
	private unsubscribe?: () => void;
	private disposed = false;

	private constructor(
		private readonly runtime: AgentSessionRuntime,
		bus: HostMessageBus,
		ui: BrowserUiContext,
		private readonly onShutdownRequest?: () => void,
	) {
		this.bus = bus;
		this.ui = ui;
	}

	static async create(options: EmbeddedPiHostOptions): Promise<EmbeddedPiHost> {
		const projectRoot = options.projectRoot ?? defaultProjectRoot();
		const { paths } = options;
		await Promise.all([
			mkdir(paths.agentDir, { recursive: true }),
			mkdir(paths.sessionsDir, { recursive: true }),
			mkdir(paths.workspaceDir, { recursive: true }),
		]);

		const bus = options.bus ?? new HostMessageBus();
		const ui = new BrowserUiContext(bus);
		const modelRuntime = await ModelRuntime.create({
			authPath: paths.authPath,
			modelsPath: join(paths.agentDir, "models.json"),
			modelsStorePath: join(paths.agentDir, "models-store.json"),
		});

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: paths.agentDir,
				modelRuntime,
				resourceLoaderOptions: isolatedResourceLoaderOptions(projectRoot),
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					noTools: "builtin",
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: paths.workspaceDir,
			agentDir: paths.agentDir,
			sessionManager: SessionManager.continueRecent(paths.workspaceDir, paths.sessionsDir),
		});
		const host = new EmbeddedPiHost(runtime, bus, ui, options.onShutdownRequest);
		runtime.setRebindSession(async (session) => host.bindSession(session, true));
		await host.bindSession(runtime.session, false);
		return host;
	}

	async prompt(text: string): Promise<void> {
		this.assertUsable();
		if (!this.runtime.session.model) throw new Error("No authenticated model is selected");
		await this.runtime.session.prompt(text, { source: "rpc" });
	}

	async steer(text: string): Promise<void> {
		this.assertUsable();
		await this.runtime.session.steer(text);
	}

	async followUp(text: string): Promise<void> {
		this.assertUsable();
		await this.runtime.session.followUp(text);
	}

	async abort(): Promise<void> {
		this.assertUsable();
		await this.runtime.session.abort();
	}

	async newSession(): Promise<void> {
		this.assertUsable();
		await this.runtime.newSession();
	}

	async setModel(provider: string, id: string): Promise<void> {
		this.assertUsable();
		const model = this.runtime.services.modelRuntime.getModel(provider, id);
		if (!model) throw new Error(`Unknown model: ${provider}/${id}`);
		if (!this.runtime.services.modelRuntime.hasConfiguredAuth(provider)) {
			throw new Error(`Provider is not authenticated: ${provider}`);
		}
		await this.runtime.session.setModel(model, { persist: true });
		this.publishSnapshot();
	}

	setThinkingLevel(level: string): void {
		this.assertUsable();
		const selected = this.runtime.session.getAvailableThinkingLevels().find((candidate) => candidate === level);
		if (!selected) throw new Error(`Thinking level is unavailable: ${level}`);
		this.runtime.session.setThinkingLevel(selected, { persist: true });
		this.publishSnapshot();
	}

	async login(provider: string, authType: AuthType, apiKey?: string): Promise<void> {
		this.assertUsable();
		let suppliedApiKey = apiKey;
		await this.runtime.services.modelRuntime.login(provider, authType, {
			prompt: (prompt) => {
				if (prompt.type === "secret" && suppliedApiKey) {
					const value = suppliedApiKey;
					suppliedApiKey = undefined;
					return Promise.resolve(value);
				}
				return this.ui.requestAuthPrompt(prompt);
			},
			notify: (event) => this.ui.notifyAuth(event),
		});
		this.bus.publish({ type: "status", status: "authenticated", scope: "auth", provider });
		this.publishSnapshot();
	}

	async logout(provider: string): Promise<void> {
		this.assertUsable();
		await this.runtime.services.modelRuntime.logout(provider);
		this.bus.publish({ type: "status", status: "logged_out", scope: "auth", provider });
		this.publishSnapshot();
	}

	snapshot(): HostSnapshot {
		const session = this.runtime.session;
		const messages = toWireValue(session.messages);
		return {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			sessionName: session.sessionName,
			messages: Array.isArray(messages) ? messages : [],
			isStreaming: session.isStreaming,
			model: session.model ? modelSummary(session.model) : undefined,
			thinkingLevel: session.thinkingLevel,
			availableThinkingLevels: session.getAvailableThinkingLevels(),
			models: this.runtime.services.modelRuntime.getAvailableSnapshot().map(modelSummary),
			providers: this.runtime.services.modelRuntime.getProviders().map((provider) => ({
				id: provider.id,
				name: provider.name,
				authenticated: this.runtime.services.modelRuntime.hasConfiguredAuth(provider.id),
			})),
		};
	}

	publishSnapshot(): void {
		this.bus.publish({ type: "snapshot", snapshot: this.snapshot() });
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.ui.cancelAll("Hopper host stopped");
		await this.runtime.dispose();
	}

	private async bindSession(session: AgentSession, replaced: boolean): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = session.subscribe((event) => {
			this.bus.publish({ type: "agent_event", event: serializeAgentEvent(event) });
		});

		await session.bindExtensions({
			uiContext: this.ui.context,
			mode: "rpc",
			abortHandler: () => { void session.abort(); },
			shutdownHandler: () => this.onShutdownRequest?.(),
			onError: (error) => this.bus.publish({
				type: "error",
				message: `${error.extensionPath}: ${error.error}`,
			}),
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: (options) => this.runtime.newSession(options),
				fork: (entryId, options) => this.runtime.fork(entryId, options),
				navigateTree: (targetId, options) => session.navigateTree(targetId, options),
				switchSession: (sessionPath, options) => this.runtime.switchSession(sessionPath, options),
				reload: () => session.reload(),
			},
		});

		if (replaced) this.bus.publish({ type: "session_replaced", session: this.snapshot() });
		this.publishSnapshot();
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error("Hopper host is stopped");
	}
}

export type HostRuntime = Pick<
	EmbeddedPiHost,
	| "abort"
	| "dispose"
	| "followUp"
	| "login"
	| "logout"
	| "newSession"
	| "prompt"
	| "setModel"
	| "setThinkingLevel"
	| "snapshot"
	| "steer"
> & {
	bus: HostMessageBus;
	ui: Pick<BrowserUiContext, "replayPending" | "respond">;
};
