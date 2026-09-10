import { TOOL_PLUGINS } from "../plugins/registry.js";
import { BUILTIN_GROUPS, type ToolPlugin, type PluginInstance } from "../plugins/types.js";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getCachedBackendStatus, probeBackend } from "../infra/backend-status.js";
import { modelSupportsImages } from "./model-capabilities.js";
import { BUILTIN_POLICY_INVENTORY } from "../tools/policy-inventory.js";
import { ToolPolicyStore } from "./tool-policy-store.js";
import { ToolCredentials, type CredentialStatus } from "./tool-credentials.js";
import {
	reconcilePolicySession, resolveToolPolicy,
	type PolicyRuntime, type PolicySession, type PolicySnapshot, type PolicyUpdate,
} from "./tool-policy.js";
import { assertCurrentToolDispatchValid, ToolPolicyDenied, withToolDispatchContext } from "./tool-policy-context.js";
import type { AgentToolSummary, AgentToolsSnapshot, ToolSettingsAction, ToolSettingsResult } from "../host/protocol.js";

const registryKey = Symbol.for("hopper.tool-policy.sessions");
const shared = globalThis as typeof globalThis & { [registryKey]?: Map<string, ToolPolicyRuntime> };
const runtimes = shared[registryKey] ??= new Map<string, ToolPolicyRuntime>();
export const toolPolicyForSession = (id: string) => runtimes.get(id);

export type ToolExecutionScope = <T>(name: string, work: () => Promise<T>, admit: () => Promise<void>) => Promise<T>;

type CredentialStatuses = Record<string, CredentialStatus>;

export const CREDENTIAL_STATUS_TIMEOUT_MS = 2_000;

export class ToolPolicyRuntime {
	private policyStore: ToolPolicyStore;
	private credentialServices = new Map<string, ToolCredentials>();
	readonly plugins: readonly ToolPlugin[];
	private pluginInstances = new Map<string, PluginInstance>();
	get store(): ToolPolicyStore { return this.policyStore; }
	credentialsFor(pluginId: string): ToolCredentials {
		const service = this.credentialServices.get(pluginId);
		if (!service) throw new ToolPolicyDenied("unknown-plugin-credential");
		return service;
	}
	readonly inventory;
	private pi?: ExtensionAPI;
	private ctx?: ExtensionContext;
	private sessionId = "";
	private generation = 0;
	private session: PolicySession = { epoch: "", appliedRevision: -1, activeIds: new Set() };
	private manual = new Map<string, { epoch: string; revision: number; generation: number }>();
	private definitions = new Map<string, ToolDefinition>();
	private schemas = new WeakMap<object, AgentToolSummary["parameters"]>();
	private published?: AgentToolsSnapshot;
	private conflicts = new Set<string>();
	private busy = false;
	private readonly hasQuestionUi: boolean;
	private closed = false;
	private unsubscribe?: () => void;
	private reconcileQueue: Promise<unknown> = Promise.resolve();
	private credentialWaits = new Set<{ policy: PolicySnapshot; pluginId: string; cancel(): void }>();
	onChange?: (snapshot: AgentToolsSnapshot) => void;

	constructor(options: { hostRoutedTools?: readonly string[]; directory?: string; embedded?: boolean; questionUi?: boolean; store?: ToolPolicyStore; credentials?: ReadonlyMap<string, ToolCredentials>; plugins?: readonly ToolPlugin[] } = {}) {
		this.hasQuestionUi = options.questionUi === true;
		this.plugins = options.store?.plugins ?? options.plugins ?? TOOL_PLUGINS;
		const inventory = [...BUILTIN_POLICY_INVENTORY, ...this.plugins.flatMap(plugin => plugin.inventory)];
		this.policyStore = options.store ?? new ToolPolicyStore(inventory, { directory: options.directory, plugins: this.plugins });
		this.inventory = this.store.inventory.filter(tool => options.embedded || tool.id !== "hopper.tool.read_skill")
			.map(tool => options.hostRoutedTools?.includes(tool.name) ? { ...tool, requirements: tool.requirements.filter(requirement => requirement !== "backend") } : tool);
		this.initializeCredentials(options.credentials);
		for (const plugin of this.plugins) {
			const instance = plugin.create({ admit: (name, signal) => this.admitPlugin(plugin.id, name, signal) });
			if (instance.tools.length !== plugin.inventory.length || new Set(instance.tools.map(tool => tool.name)).size !== instance.tools.length
				|| instance.tools.some(tool => !plugin.inventory.some(entry => entry.name === tool.name))) throw new Error("Plugin tools do not match their declaration");
			this.pluginInstances.set(plugin.id, instance);
		}
	}

	private initializeCredentials(services?: ReadonlyMap<string, ToolCredentials>): void {
		this.credentialServices.clear();
		for (const plugin of this.plugins.filter(plugin => plugin.credential)) {
			const service = services?.get(plugin.id) ?? new ToolCredentials(this.store, plugin.id);
			if (service.pluginId !== plugin.id || service.store !== this.store) throw new Error("Plugin credential service mismatch");
			this.credentialServices.set(plugin.id, service);
		}
	}

	get pluginCatalog() {
		return this.plugins.flatMap(plugin => this.pluginInstances.get(plugin.id)!.tools.map(tool => ({
			tool, group: `plugin:${plugin.id}`, keywords: plugin.keywords,
			alwaysActive: plugin.inventory.find(entry => entry.name === tool.name)!.defaultActive,
		})));
	}

	registerPlugins(pi: ExtensionAPI): void {
		for (const plugin of this.plugins) {
			const tools = this.pluginInstances.get(plugin.id)!.tools;
			const names = new Set(pi.getAllTools().map(tool => tool.name));
			// Reject the whole plugin before registering any tool on a name collision.
			if (tools.some(tool => names.has(tool.name) && !this.hasRegistration(tool.name))) this.markPluginConflict(plugin.id);
			else for (const tool of tools) this.register(pi, tool);
		}
	}

	private abortPlugins(): void { for (const instance of this.pluginInstances.values()) instance.abortAll(); }

	/** CLI extension flags become available after factories load, before session_start. */
	configureDirectory(directory: string): void {
		if (this.pi || this.closed) throw new ToolPolicyDenied("profile-already-bound");
		const store = new ToolPolicyStore(this.store.inventory, { directory, plugins: this.plugins });
		void this.policyStore.close();
		this.policyStore = store;
		this.initializeCredentials();
	}

	bind(pi: ExtensionAPI, ctx: ExtensionContext, progressive: boolean): void {
		this.pi = pi;
		this.ctx = ctx;
		this.progressive = progressive;
		const id = ctx.sessionManager.getSessionId();
		if (id !== this.sessionId) {
			if (runtimes.get(this.sessionId) === this) runtimes.delete(this.sessionId);
			this.generation++;
			this.cancelCredentialWaits();
			this.manual.clear();
			this.abortPlugins();
			this.session = { epoch: "", appliedRevision: -1, activeIds: new Set() };
			this.sessionId = id;
			this.published = undefined;
		}
		runtimes.set(id, this);
		this.unsubscribe ??= this.store.subscribe(snapshot => {
			this.observe(snapshot);
			if (!this.busy) void this.reconcile().catch(() => {});
			else void this.publish();
		});
	}
	private progressive = false;
	setContext(ctx: ExtensionContext): void { this.ctx = ctx; }
	setBusy(busy: boolean): void { this.busy = busy; }
	isBusy(): boolean { return this.busy; }
	hasRegistration(name: string): boolean { return this.definitions.has(name); }
	isToolExposed(name: string): boolean { return this.session.activeIds.has(this.inventory.find(tool => tool.name === name)?.id ?? ""); }
	markPluginConflict(owner: string): void { for (const tool of this.inventory.filter(tool => tool.owner === owner)) this.conflicts.add(tool.id); }

	register(pi: ExtensionAPI, tool: ToolDefinition, runTool?: ToolExecutionScope): boolean {
		const entry = this.inventory.find(entry => entry.name === tool.name);
		if (!entry) throw new ToolPolicyDenied("unmanaged-registration");
		if (this.definitions.has(tool.name)) return true;
		if (pi.getAllTools().some(existing => existing.name === tool.name)) {
			this.conflicts.add(entry.id);
			return false;
		}
		this.definitions.set(tool.name, tool);
		pi.registerTool(this.wrap(tool, runTool));
		return true;
	}

	/** Host-owned custom tools are supplied before the extension registry is bound. */
	customTool(tool: ToolDefinition): ToolDefinition {
		this.definitions.set(tool.name, tool);
		return this.wrap(tool);
	}

	wrap<T extends ToolDefinition>(tool: T, runTool?: ToolExecutionScope): T {
		const runtime = this;
		return { ...tool, async execute(...args) {
			const generation = runtime.generation;
			const signal = args[2];
			try {
				await runtime.preflight(tool.name, generation, signal);
				const admit = () => runtime.admit(tool.name, generation, signal);
				const work = () => withToolDispatchContext(
					admit,
					() => {
						runtime.assertSession(generation, signal);
						return tool.execute(...args);
					},
					() => runtime.assertSession(generation, signal),
				);
				// Native activation is admitted separately; cleanup must survive policy revocation.
				return await (runTool ? runTool(tool.name, work, admit) : work());
			} catch (error) {
				if (!(error instanceof ToolPolicyDenied)) throw error;
				return { isError: true, content: [{ type: "text", text: error.message }], details: { code: error.code } };
			}
		} } as T;
	}

	private assertSession(generation: number, signal?: AbortSignal): void {
		if (this.closed || generation !== this.generation || signal?.aborted) throw new ToolPolicyDenied("cancelled");
	}
	private entry(name: string) {
		const entry = this.inventory.find(tool => tool.name === name);
		if (!entry || this.conflicts.has(entry.id)) throw new ToolPolicyDenied("registration-conflict");
		return entry;
	}
	private runtimeState(policy: PolicySnapshot | null, statuses: CredentialStatuses | "configured" | "unavailable" = {}): PolicyRuntime {
		return {
			backend: getCachedBackendStatus()?.online === true,
			images: modelSupportsImages(this.ctx?.model), ui: this.hasQuestionUi || this.ctx?.hasUI === true,
			credentials: Object.fromEntries(this.plugins.filter(plugin => plugin.credential).map(plugin => {
				const status = typeof statuses === "string" ? statuses : statuses[plugin.id] ?? "missing";
				return [plugin.id, { status, ...(status === "configured" && policy ? { generation: policy.credentials[plugin.id]?.generation } : {}) }];
			})),
		};
	}

	async preflight(name: string, generation = this.generation, signal?: AbortSignal): Promise<PolicySnapshot> {
		const entry = this.entry(name);
		const prepared = await this.locked(policy => {
			this.assertSession(generation, signal);
			// Check all gates before execution, allowing an offline backend to recover.
			const state = { ...this.runtimeState(policy, "configured"), backend: true };
			const status = resolveToolPolicy(entry, policy, state, this.session, true);
			if (!status.callable) throw new ToolPolicyDenied(status.status);
			return policy;
		});
		if (entry.requirements.includes("backend") && getCachedBackendStatus()?.online !== true) {
			await probeBackend();
			await this.admit(name, generation, signal);
		}
		this.assertSession(generation, signal);
		return prepared;
	}

	async admit(name: string, generation = this.generation, signal?: AbortSignal): Promise<void> {
		const entry = this.entry(name);
		await this.locked(policy => {
			this.assertSession(generation, signal);
			// Provider adapters perform credential admission immediately before each request.
			const status = resolveToolPolicy(entry, policy, this.runtimeState(policy, "configured"), this.session, true);
			if (!status.callable) throw new ToolPolicyDenied(status.status);
		});
	}

	async admitPlugin(pluginId: string, name: string, signal?: AbortSignal): Promise<{ apiKey: string }> {
		assertCurrentToolDispatchValid();
		const generation = this.generation;
		if (this.entry(name).owner !== pluginId || !this.plugins.some(plugin => plugin.id === pluginId)) throw new ToolPolicyDenied("plugin-tool-mismatch");
		const prepared = await this.preflight(name, generation, signal);
		if (!this.entry(name).requirements.includes("credential")) { await this.admit(name, generation, signal); return { apiKey: "" }; }
		let apiKey: string | null;
		try { apiKey = await this.credentialsFor(pluginId).read(prepared); }
		catch { throw new ToolPolicyDenied("credential-store-unavailable"); }
		if (!apiKey) throw new ToolPolicyDenied("api-key-required");
		await this.locked(policy => {
			assertCurrentToolDispatchValid();
			this.assertSession(generation, signal);
			if (policy.epoch !== prepared.epoch || policy.credentials[pluginId].generation !== prepared.credentials[pluginId].generation
				|| policy.credentials[pluginId].reference !== prepared.credentials[pluginId].reference) throw new ToolPolicyDenied("credential-changed");
			const state = resolveToolPolicy(this.entry(name), policy, this.runtimeState(policy, "configured"), this.session, true);
			if (!state.callable) throw new ToolPolicyDenied(state.status);
		});
		return { apiKey };
	}

	private async locked<T>(fn: (snapshot: PolicySnapshot) => T): Promise<T> {
		try { return await this.store.withSnapshot(fn); }
		catch (error) {
			if (error instanceof ToolPolicyDenied) throw error;
			throw new ToolPolicyDenied("settings-unavailable");
		}
	}

	private observe(policy: PolicySnapshot | null): void {
		for (const wait of this.credentialWaits) {
			if (!policy || policy.epoch !== wait.policy.epoch || policy.revision > wait.policy.revision
				|| !this.needsCredentialStatus(policy, wait.pluginId)) wait.cancel();
		}
		for (const [id, activation] of this.manual) {
			const entry = this.inventory.find(tool => tool.id === id)!;
			if (!policy || activation.epoch !== policy.epoch || activation.generation !== this.generation
				|| !policy.tools[id]?.enabled || !policy.parents[entry.parent]?.enabled
				|| Math.max(policy.tools[id].enabledAt, policy.parents[entry.parent].enabledAt) > activation.revision) this.manual.delete(id);
		}
		for (const plugin of this.plugins) {
			const instance = this.pluginInstances.get(plugin.id)!;
			if (!policy || !policy.parents[plugin.id]?.enabled) instance.abortAll();
			else for (const entry of plugin.inventory) {
				if (!policy.tools[entry.id]?.enabled || (entry.requirements.includes("credential") && !policy.credentials[plugin.id]?.reference)) instance.abortTool(entry.name);
			}
		}
	}

	/** Serialize local boundary reconciliation, never a full prompt or backend probe. */
	async reconcile(boundary = false): Promise<void> {
		await this.reconcileSnapshot(boundary);
	}

	private needsCredentialStatus(policy: PolicySnapshot, pluginId: string): boolean {
		return !!policy.parents[pluginId]?.enabled && this.inventory.some(tool => tool.owner === pluginId && tool.requirements.includes("credential") && policy.tools[tool.id]?.enabled);
	}

	private cancelCredentialWaits(): void {
		for (const wait of this.credentialWaits) wait.cancel();
	}

	private credentialStatus(policy: PolicySnapshot, pluginId: string): Promise<CredentialStatus> {
		// A saved reference is enough to display a disabled plugin's setup state.
		// Only enabled tools need protected-store availability checked at a boundary.
		if (!policy.credentials[pluginId]?.reference) return Promise.resolve("missing" as const);
		if (!this.needsCredentialStatus(policy, pluginId)) {
			return Promise.resolve("configured" as const);
		}
		if (this.closed) return Promise.resolve("unavailable");
		return new Promise(resolve => {
			const finish = (status: CredentialStatus) => {
				clearTimeout(timer);
				this.credentialWaits.delete(wait);
				resolve(status);
			};
			const wait = { policy, pluginId, cancel: () => finish("unavailable") };
			const timer = setTimeout(wait.cancel, CREDENTIAL_STATUS_TIMEOUT_MS);
			this.credentialWaits.add(wait);
			// Native reads may not be cancellable. Release the caller and ignore late
			// completion; a subsequent reconciliation samples credentials afresh.
			void Promise.resolve().then(() => this.credentialsFor(pluginId).status(policy)).then(finish, wait.cancel);
		});
	}

	private async credentialStatuses(policy: PolicySnapshot): Promise<CredentialStatuses> {
		return Object.fromEntries(await Promise.all(this.plugins.filter(plugin => plugin.credential).map(async plugin =>
			[plugin.id, await this.credentialStatus(policy, plugin.id)])));
	}

	private currentCredentials(prepared: PolicySnapshot, latest: PolicySnapshot, statuses: CredentialStatuses): CredentialStatuses {
		return Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id,
			prepared.epoch === latest.epoch && prepared.credentials[id]?.generation === latest.credentials[id]?.generation
				&& prepared.credentials[id]?.reference === latest.credentials[id]?.reference
				&& (!this.needsCredentialStatus(latest, id) || this.needsCredentialStatus(prepared, id)) ? status : "unavailable",
		]));
	}

	private async reconcileSnapshot(boundary = false): Promise<AgentToolsSnapshot> {
		// Read outside the queue so a missed watcher event cannot leave a new
		// boundary behind an obsolete protected-store wait.
		if (this.credentialWaits.size) this.observe(await this.store.read().catch(() => null));
		const pending = this.reconcileQueue.catch(() => {}).then(async () => {
			if (!this.pi || !this.ctx || this.closed) return this.getToolSettings();
			const generation = this.generation;
			let policy: PolicySnapshot;
			try { policy = await this.store.read(); }
			catch { this.observe(null); this.applyBlocked(); return this.publish(this.formatToolSettings(null, "unavailable")); }
			this.observe(policy);
			if (getCachedBackendStatus()?.online !== true && this.inventory.some(tool => this.definitions.has(tool.name) && tool.requirements.includes("backend")
				&& policy.tools[tool.id]?.enabled && policy.parents[tool.parent]?.enabled)) await probeBackend();
			const credential = await this.credentialStatuses(policy);
			const snapshot = await this.locked(latest => {
				this.assertSession(generation);
				this.observe(latest);
				const currentCredential = this.currentCredentials(policy, latest, credential);
				if (!boundary && this.busy) return this.formatToolSettings(latest, currentCredential);
				const eligible = this.inventory.filter(tool => !this.conflicts.has(tool.id) && this.definitions.has(tool.name));
				this.session = reconcilePolicySession(eligible, latest, this.runtimeState(latest, currentCredential), this.progressive, new Set(this.manual.keys()));
				const managed = new Set(this.inventory.filter(tool => !this.conflicts.has(tool.id)).map(tool => tool.name));
				const preserved = this.pi!.getActiveTools().filter(name => !managed.has(name));
				this.setActiveTools([...preserved, ...eligible.filter(tool => this.session.activeIds.has(tool.id)).map(tool => tool.name)]);
				return this.formatToolSettings(latest, currentCredential);
			});
			return this.publish(snapshot);
		});
		this.reconcileQueue = pending;
		return pending;
	}

	private setActiveTools(names: string[]): void {
		if (this.pi && !isDeepStrictEqual(this.pi.getActiveTools(), names)) this.pi.setActiveTools(names);
	}

	private applyBlocked(): void {
		this.session = { epoch: "", appliedRevision: -1, activeIds: new Set() };
		const managed = new Set(this.inventory.filter(tool => !this.conflicts.has(tool.id)).map(tool => tool.name));
		this.setActiveTools(this.pi?.getActiveTools().filter(name => !managed.has(name)) ?? []);
	}

	async activateByName(name: string): Promise<void> {
		await this.activate(this.entry(name).id);
	}

	async activate(id: string): Promise<void> {
		assertCurrentToolDispatchValid();
		const generation = this.generation;
		const prepared = await this.store.read();
		const tool = this.inventory.find(tool => tool.id === id);
		const credential: CredentialStatuses = tool?.requirements.includes("credential")
			? { [tool.owner]: await this.credentialStatus(prepared, tool.owner) } : {};
		await this.locked(policy => {
			assertCurrentToolDispatchValid();
			this.assertSession(generation);
			const entry = this.inventory.find(tool => tool.id === id);
			if (!entry || this.conflicts.has(id) || !this.definitions.has(entry.name) || !policy.tools[id]?.enabled || !policy.parents[entry.parent]?.enabled) throw new ToolPolicyDenied("disabled-by-user");
			if (prepared.epoch !== policy.epoch || Math.max(policy.tools[id].enabledAt, policy.parents[entry.parent].enabledAt) > prepared.revision) throw new ToolPolicyDenied("activation-superseded");
			const currentCredential = this.currentCredentials(prepared, policy, credential);
			const state = resolveToolPolicy(entry, policy, this.runtimeState(policy, currentCredential), this.session, true);
			if (!state.available) throw new ToolPolicyDenied(state.status);
			this.manual.set(id, { epoch: policy.epoch, revision: policy.revision, generation: this.generation });
		});
	}

	async allowedToolNames(): Promise<Set<string>> {
		return this.locked(policy => new Set(this.inventory.filter(tool => !this.conflicts.has(tool.id)
			&& policy.tools[tool.id]?.enabled && policy.parents[tool.parent]?.enabled).map(tool => tool.name)));
	}

	async getToolSettings(backendPreview?: boolean): Promise<AgentToolsSnapshot> {
		let policy: PolicySnapshot | null;
		try { policy = await this.store.read(); } catch { policy = null; }
		this.observe(policy);
		const credential = policy ? await this.credentialStatuses(policy) : "unavailable";
		return this.formatToolSettings(policy, credential, backendPreview);
	}

	private parameters(schema?: object): AgentToolSummary["parameters"] {
		if (!schema) return {};
		let parameters = this.schemas.get(schema);
		if (!parameters) {
			parameters = JSON.parse(JSON.stringify(schema)) as AgentToolSummary["parameters"];
			this.schemas.set(schema, parameters);
		}
		return parameters;
	}

	private formatToolSettings(policy: PolicySnapshot | null, credential: CredentialStatuses | "unavailable", backendPreview?: boolean): AgentToolsSnapshot {
		const state = this.runtimeState(policy, credential);
		if (backendPreview !== undefined) state.backend = backendPreview;
		// A target preview describes availability, never the admin agent's exposure.
		const session = backendPreview === undefined ? this.session : {
			epoch: policy?.epoch ?? "", appliedRevision: policy?.revision ?? -1, activeIds: new Set<string>(),
		};
		const discovery = !!policy?.tools["hopper.tool.hopper_search_tools"]?.enabled && !!policy?.parents["hopper.interaction"]?.enabled;
		const tools: AgentToolSummary[] = this.inventory.map(entry => {
			const definition = this.definitions.get(entry.name);
			const status = resolveToolPolicy(entry, policy, state, session, discovery);
			return {
				name: entry.name, id: entry.id, parent: entry.parent, description: definition?.description ?? entry.name,
				parameters: this.parameters(definition?.parameters),
				...status, enabled: policy?.tools[entry.id]?.enabled ?? false,
				...(this.conflicts.has(entry.id) ? { status: "registration-conflict" as const, available: false, callable: false, active: false } : {}),
				...(backendPreview === undefined && this.busy && policy && (policy.epoch !== this.session.epoch || policy.revision > this.session.appliedRevision)
					&& status.enabled && status.available ? { status: "pending-exposure" as const } : {}),
			};
		});
		const managedNames = new Set(this.inventory.map(entry => entry.name));
		const activeNames = new Set(this.pi?.getActiveTools() ?? []);
		for (const tool of this.pi?.getAllTools() ?? []) {
			if (!managedNames.has(tool.name)) tools.push({ name: tool.name, description: tool.description,
				parameters: this.parameters(tool.parameters), active: backendPreview === undefined && activeNames.has(tool.name) });
		}
		return { tools, settings: {
			version: policy ? { epoch: policy.epoch, revision: policy.revision } : null,
			parents: [
				...Object.entries(BUILTIN_GROUPS).map(([id, group]) => ({ id, name: group.name, enabled: policy?.parents[id]?.enabled ?? false })),
				...this.plugins.map(plugin => ({ id: plugin.id, name: plugin.name, description: plugin.description, enabled: policy?.parents[plugin.id]?.enabled ?? false,
					...(plugin.credential ? { credential: { ...plugin.credential, status: typeof credential === "string" ? credential : credential[plugin.id] ?? "missing" } } : {}),
				})),
			], ...(!policy ? { error: "Settings unavailable. Repair settings to restore defaults." } : {}),
		} };
	}

	async updateToolSettings(action: ToolSettingsAction): Promise<ToolSettingsResult> {
		let result: PolicyUpdate | undefined;
		try {
			switch (action.type) {
				case "patch": result = await this.store.update(action.expected, action.patch); break;
				case "reset": result = await this.store.reset(action.expected); break;
				case "repair": this.observe(await this.store.repair()); break;
				case "activate": await this.activate(action.id); break;
				case "check-connection": await probeBackend(); break;
				case "credential":
					if (action.action === "remove") {
						const removed = await this.credentialsFor(action.pluginId).remove(action.expected);
						result = removed;
						if (removed.deletionFailed) {
							this.observe(removed.snapshot);
							return { ok: false, code: "error", error: "Key access removed; protected entry deletion failed. Retry removal.", snapshot: await this.getToolSettings() };
						}
					} else result = await this.credentialsFor(action.pluginId).save(action.expected, action.key, action.action === "save-and-enable");
			}
			if (result && !result.ok) return { ok: false, code: result.code === "conflict" ? "conflict" : "error", error: result.code === "conflict"
				? "Settings changed in another window; review and try again." : "Setting could not be saved.", snapshot: await this.getToolSettings() };
			if (result) this.observe(result.snapshot);
			const snapshot = this.busy ? await this.publish() : await this.reconcileSnapshot();
			return { ok: true, snapshot };
		} catch {
			return { ok: false, code: "error", error: "Setting could not be saved. Check settings and protected credential storage.", snapshot: await this.getToolSettings() };
		}
	}

	private async publish(prepared?: AgentToolsSnapshot): Promise<AgentToolsSnapshot> {
		const snapshot = prepared ?? await this.getToolSettings();
		if (!this.closed && !isDeepStrictEqual(this.published, snapshot)) {
			this.published = snapshot;
			this.onChange?.(snapshot);
		}
		return snapshot;
	}
	async close(): Promise<void> {
		this.closed = true; this.generation++; this.abortPlugins(); this.unsubscribe?.();
		this.cancelCredentialWaits();
		if (runtimes.get(this.sessionId) === this) runtimes.delete(this.sessionId);
		await this.store.close();
		await this.reconcileQueue.catch(() => {});
	}
}
