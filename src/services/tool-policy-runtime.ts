import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getCachedBackendStatus, probeBackend } from "../infra/backend-status.js";
import { modelSupportsImages } from "./model-capabilities.js";
import { HOPPER_POLICY_INVENTORY } from "../tools/policy-inventory.js";
import { ToolPolicyStore } from "./tool-policy-store.js";
import { ToolCredentials } from "./tool-credentials.js";
import {
	PARENT_DEFAULTS, reconcilePolicySession, resolveToolPolicy,
	type PolicyRuntime, type PolicySession, type PolicySnapshot, type PolicyUpdate,
} from "./tool-policy.js";
import { assertCurrentToolDispatchValid, ToolPolicyDenied, withToolDispatchContext } from "./tool-policy-context.js";
import type { AgentToolSummary, AgentToolsSnapshot, ToolSettingsAction, ToolSettingsResult } from "../host/protocol.js";

const registryKey = Symbol.for("hopper.tool-policy.sessions");
const shared = globalThis as typeof globalThis & { [registryKey]?: Map<string, ToolPolicyRuntime> };
const runtimes = shared[registryKey] ??= new Map<string, ToolPolicyRuntime>();
export const toolPolicyForSession = (id: string) => runtimes.get(id);

const parentNames: Record<string, string> = {
	"hopper.rhino": "Rhino", "hopper.grasshopper": "Grasshopper",
	"hopper.interaction": "Interaction", "hopper.skills": "Skills", firecrawl: "Firecrawl",
};

export class ToolPolicyRuntime {
	private policyStore: ToolPolicyStore;
	private credentialService: ToolCredentials;
	get store(): ToolPolicyStore { return this.policyStore; }
	get credentials(): ToolCredentials { return this.credentialService; }
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
	private closed = false;
	private unsubscribe?: () => void;
	private reconcileQueue: Promise<unknown> = Promise.resolve();
	onChange?: (snapshot: AgentToolsSnapshot) => void;
	abortProvider?: (name?: string) => void;

	constructor(options: { directory?: string; embedded?: boolean; store?: ToolPolicyStore; credentials?: ToolCredentials } = {}) {
		this.inventory = HOPPER_POLICY_INVENTORY.filter(tool => options.embedded || tool.id !== "hopper.tool.read_skill");
		// Both modes persist the complete inventory, including embedded-only preferences.
		this.policyStore = options.store ?? new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory: options.directory });
		this.credentialService = options.credentials ?? new ToolCredentials(this.store);
	}

	/** CLI extension flags become available after factories load, before session_start. */
	configureDirectory(directory: string): void {
		if (this.pi || this.closed) throw new ToolPolicyDenied("profile-already-bound");
		const store = new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory });
		void this.policyStore.close();
		this.policyStore = store;
		this.credentialService = new ToolCredentials(store);
	}

	bind(pi: ExtensionAPI, ctx: ExtensionContext, progressive: boolean): void {
		this.pi = pi;
		this.ctx = ctx;
		this.progressive = progressive;
		const id = ctx.sessionManager.getSessionId();
		if (id !== this.sessionId) {
			if (runtimes.get(this.sessionId) === this) runtimes.delete(this.sessionId);
			this.generation++;
			this.manual.clear();
			this.abortProvider?.();
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

	register(pi: ExtensionAPI, tool: ToolDefinition): boolean {
		const entry = this.inventory.find(entry => entry.name === tool.name);
		if (!entry) throw new ToolPolicyDenied("unmanaged-registration");
		if (this.definitions.has(tool.name)) return true;
		if (pi.getAllTools().some(existing => existing.name === tool.name)) {
			this.conflicts.add(entry.id);
			return false;
		}
		this.definitions.set(tool.name, tool);
		pi.registerTool(this.wrap(tool));
		return true;
	}

	/** Host-owned custom tools are supplied before the extension registry is bound. */
	customTool(tool: ToolDefinition): ToolDefinition {
		this.definitions.set(tool.name, tool);
		return this.wrap(tool);
	}

	wrap<T extends ToolDefinition>(tool: T): T {
		const runtime = this;
		return { ...tool, async execute(...args) {
			const generation = runtime.generation;
			const signal = args[2];
			try {
				await runtime.preflight(tool.name, generation, signal);
				return await withToolDispatchContext(
					() => runtime.admit(tool.name, generation, signal),
					() => {
						runtime.assertSession(generation, signal);
						return tool.execute(...args);
					},
					() => runtime.assertSession(generation, signal),
				);
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
	private runtimeState(policy: PolicySnapshot | null, credential: "configured" | "missing" | "unavailable" = "missing"): PolicyRuntime {
		return {
			backend: getCachedBackendStatus()?.online === true,
			images: modelSupportsImages(this.ctx?.model), ui: this.ctx?.hasUI === true,
			credentialStore: credential === "unavailable" ? "unavailable" : "available",
			credentialMissing: credential === "missing",
			...(credential === "configured" && policy ? { credentialGeneration: policy.credentials.firecrawl.generation } : {}),
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
			// Firecrawl performs its credential admission separately immediately before fetch.
			const status = resolveToolPolicy(entry, policy, this.runtimeState(policy, entry.owner === "firecrawl" ? "configured" : "missing"), this.session, true);
			if (!status.callable) throw new ToolPolicyDenied(status.status);
		});
	}

	async admitFirecrawl(name: "web_search" | "web_fetch", signal?: AbortSignal): Promise<{ apiKey: string }> {
		assertCurrentToolDispatchValid();
		const generation = this.generation;
		const prepared = await this.preflight(name, generation, signal);
		let apiKey: string | null;
		try { apiKey = await this.credentials.read(prepared); }
		catch { throw new ToolPolicyDenied("credential-store-unavailable"); }
		if (!apiKey) throw new ToolPolicyDenied("api-key-required");
		await this.locked(policy => {
			assertCurrentToolDispatchValid();
			this.assertSession(generation, signal);
			if (policy.epoch !== prepared.epoch || policy.credentials.firecrawl.generation !== prepared.credentials.firecrawl.generation
				|| policy.credentials.firecrawl.reference !== prepared.credentials.firecrawl.reference) throw new ToolPolicyDenied("credential-changed");
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
		for (const [id, activation] of this.manual) {
			const entry = this.inventory.find(tool => tool.id === id)!;
			if (!policy || activation.epoch !== policy.epoch || activation.generation !== this.generation
				|| !policy.tools[id]?.enabled || !policy.parents[entry.parent]?.enabled
				|| Math.max(policy.tools[id].enabledAt, policy.parents[entry.parent].enabledAt) > activation.revision) this.manual.delete(id);
		}
		if (!policy || !policy.parents.firecrawl.enabled || !policy.credentials.firecrawl.reference) this.abortProvider?.();
		else for (const entry of this.inventory.filter(tool => tool.owner === "firecrawl")) {
			if (!policy.tools[entry.id]?.enabled) this.abortProvider?.(entry.name);
		}
	}

	/** Serialize local boundary reconciliation, never a full prompt or backend probe. */
	async reconcile(boundary = false): Promise<void> {
		await this.reconcileSnapshot(boundary);
	}

	private needsCredentialStatus(policy: PolicySnapshot): boolean {
		return policy.parents.firecrawl.enabled && this.inventory.some(tool => tool.owner === "firecrawl" && policy.tools[tool.id]?.enabled);
	}

	private credentialStatus(policy: PolicySnapshot) {
		// A saved reference is enough to display disabled Firecrawl's setup state.
		// Only enabled tools need protected-store availability checked at a boundary.
		if (!policy.credentials.firecrawl.reference) return Promise.resolve("missing" as const);
		if (!this.needsCredentialStatus(policy)) {
			return Promise.resolve("configured" as const);
		}
		return this.credentials.status(policy);
	}

	private reconcileSnapshot(boundary = false): Promise<AgentToolsSnapshot> {
		const pending = this.reconcileQueue.catch(() => {}).then(async () => {
			if (!this.pi || !this.ctx || this.closed) return this.getToolSettings();
			const generation = this.generation;
			let policy: PolicySnapshot;
			try { policy = await this.store.read(); }
			catch { this.observe(null); this.applyBlocked(); return this.publish(this.formatToolSettings(null, "unavailable")); }
			this.observe(policy);
			if (getCachedBackendStatus()?.online !== true && this.inventory.some(tool => tool.requirements.includes("backend")
				&& policy.tools[tool.id]?.enabled && policy.parents[tool.parent]?.enabled)) await probeBackend();
			const credential = await this.credentialStatus(policy);
			const snapshot = await this.locked(latest => {
				this.assertSession(generation);
				this.observe(latest);
				const currentCredential = latest.credentials.firecrawl.generation === policy.credentials.firecrawl.generation
					&& latest.credentials.firecrawl.reference === policy.credentials.firecrawl.reference && latest.epoch === policy.epoch
					&& (!this.needsCredentialStatus(latest) || this.needsCredentialStatus(policy)) ? credential : "unavailable";
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
		const credential = this.inventory.find(tool => tool.id === id)?.owner === "firecrawl"
			? await this.credentials.status(prepared) : "missing";
		await this.locked(policy => {
			assertCurrentToolDispatchValid();
			this.assertSession(generation);
			const entry = this.inventory.find(tool => tool.id === id);
			if (!entry || this.conflicts.has(id) || !this.definitions.has(entry.name) || !policy.tools[id]?.enabled || !policy.parents[entry.parent]?.enabled) throw new ToolPolicyDenied("disabled-by-user");
			if (prepared.epoch !== policy.epoch || Math.max(policy.tools[id].enabledAt, policy.parents[entry.parent].enabledAt) > prepared.revision) throw new ToolPolicyDenied("activation-superseded");
			const currentCredential = prepared.epoch === policy.epoch && prepared.credentials.firecrawl.generation === policy.credentials.firecrawl.generation ? credential : "unavailable";
			const state = resolveToolPolicy(entry, policy, this.runtimeState(policy, currentCredential), this.session, true);
			if (!state.available) throw new ToolPolicyDenied(state.status);
			this.manual.set(id, { epoch: policy.epoch, revision: policy.revision, generation: this.generation });
		});
	}

	async allowedToolNames(): Promise<Set<string>> {
		return this.locked(policy => new Set(this.inventory.filter(tool => !this.conflicts.has(tool.id)
			&& policy.tools[tool.id]?.enabled && policy.parents[tool.parent]?.enabled).map(tool => tool.name)));
	}

	async getToolSettings(): Promise<AgentToolsSnapshot> {
		let policy: PolicySnapshot | null;
		try { policy = await this.store.read(); } catch { policy = null; }
		this.observe(policy);
		const credential = policy ? await this.credentialStatus(policy) : "unavailable";
		return this.formatToolSettings(policy, credential);
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

	private formatToolSettings(policy: PolicySnapshot | null, credential: "configured" | "missing" | "unavailable"): AgentToolsSnapshot {
		const state = this.runtimeState(policy, credential);
		const discovery = !!policy?.tools["hopper.tool.hopper_search_tools"]?.enabled && !!policy?.parents["hopper.interaction"]?.enabled;
		const tools: AgentToolSummary[] = this.inventory.map(entry => {
			const definition = this.definitions.get(entry.name);
			const status = resolveToolPolicy(entry, policy, state, this.session, discovery);
			return {
				name: entry.name, id: entry.id, parent: entry.parent, description: definition?.description ?? entry.name,
				parameters: this.parameters(definition?.parameters),
				...status, enabled: policy?.tools[entry.id]?.enabled ?? false,
				...(this.conflicts.has(entry.id) ? { status: "registration-conflict" as const, available: false, callable: false, active: false } : {}),
				...(this.busy && policy && (policy.epoch !== this.session.epoch || policy.revision > this.session.appliedRevision)
					&& status.enabled && status.available ? { status: "pending-exposure" as const } : {}),
			};
		});
		const managedNames = new Set(this.inventory.map(entry => entry.name));
		const activeNames = new Set(this.pi?.getActiveTools() ?? []);
		for (const tool of this.pi?.getAllTools() ?? []) {
			if (!managedNames.has(tool.name)) tools.push({ name: tool.name, description: tool.description,
				parameters: this.parameters(tool.parameters), active: activeNames.has(tool.name) });
		}
		return { tools, settings: {
			version: policy ? { epoch: policy.epoch, revision: policy.revision } : null,
			parents: Object.keys(PARENT_DEFAULTS).map(id => ({ id, name: parentNames[id], enabled: policy?.parents[id]?.enabled ?? false })),
			credential, ...(!policy ? { error: "Settings unavailable. Repair settings to restore defaults." } : {}),
		} };
	}

	async updateToolSettings(action: ToolSettingsAction): Promise<ToolSettingsResult> {
		let result: PolicyUpdate | undefined;
		try {
			switch (action.type) {
				case "patch": result = await this.store.update(action.expected, action.patch); break;
				case "reset": result = await this.store.reset(action.expected); break;
				case "repair": await this.store.repair(); break;
				case "activate": await this.activate(action.id); break;
				case "check-connection": await probeBackend(); break;
				case "credential":
					if (action.action === "remove") {
						const removed = await this.credentials.remove(action.expected);
						result = removed;
						if (removed.deletionFailed) {
							this.observe(removed.snapshot);
							return { ok: false, code: "error", error: "Key access removed; protected entry deletion failed. Retry removal.", snapshot: await this.getToolSettings() };
						}
					} else result = await this.credentials.save(action.expected, action.key, action.action === "save-and-enable");
			}
			if (result && !result.ok) return { ok: false, code: result.code === "conflict" ? "conflict" : "error", error: result.code === "conflict"
				? "Settings changed in another window; review and try again." : "Setting could not be saved.", snapshot: await this.getToolSettings() };
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
		this.closed = true; this.generation++; this.abortProvider?.(); this.unsubscribe?.();
		if (runtimes.get(this.sessionId) === this) runtimes.delete(this.sessionId);
		await this.store.close();
		await this.reconcileQueue.catch(() => {});
	}
}
