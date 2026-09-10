import { TOOL_PLUGINS } from "../plugins/registry.js";
import { validatePlugins, type ToolPlugin } from "../plugins/types.js";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { decodeToolPolicy } from "./tool-policy-schema.js";
import { toolPolicyProfileDirectory } from "./tool-policy-profile.js";
import { assertPolicyInventory, parentDefaults, createPolicyDefaults, patchPolicy, resetToolPolicy, type PolicyPatch, type PolicySnapshot, type PolicyUpdate, type PolicyVersion, type ToolPolicyDescriptor } from "./tool-policy.js";

export class ToolSettingsError extends Error {
	readonly code = "settings-unavailable";
	constructor() { super("Tool settings are unavailable. Repair settings to restore access."); }
}

/** Every authoritative read and write locks the same stable file. Never unlink it.
 * Native whole-file flock / LockFileEx locks are released by the OS on process death.
 * A timeout denies access; it never steals a living owner's lock. */
export class ToolPolicyStore {
	readonly directory: string;
	private observed = false;
	private closed = false;
	private operations = new Set<Promise<unknown>>();
	private listeners = new Set<(snapshot: PolicySnapshot | null) => void>();
	private timer?: ReturnType<typeof setInterval>;
	private polling = false;
	private notified?: string;
	readonly plugins: readonly ToolPlugin[];
	constructor(readonly inventory: readonly ToolPolicyDescriptor[], options: { directory?: string; plugins?: readonly ToolPlugin[] } = {}) {
		this.plugins = options.plugins ?? TOOL_PLUGINS;
		validatePlugins(this.plugins);
		assertPolicyInventory(inventory, this.plugins);
		this.directory = toolPolicyProfileDirectory({ configDirectory: options.directory });
	}
	private locked<T>(fn: () => Promise<T>): Promise<T> {
		if (this.closed) return Promise.reject(new ToolSettingsError());
		// Track before any asynchronous mkdir, import or native acquisition finishes.
		const operation = this.runLocked(fn);
		this.operations.add(operation);
		void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
		return operation;
	}
	private async runLocked<T>(fn: () => Promise<T>): Promise<T> {
		let guard: { drop(): Promise<void> };
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const { openLock, Lock } = await import("@lickle/lock");
			guard = await openLock(join(this.directory, "tool-settings.lock"), Lock.Exclusive, { timeout: 5000 });
		} catch { throw new ToolSettingsError(); }
		try { return await fn(); } finally { await guard.drop().catch(() => {}); }
	}
	private async write(snapshot: PolicySnapshot): Promise<void> {
		const temporary = join(this.directory, `tool-settings.${randomUUID()}.tmp`);
		try {
			const file = await open(temporary, "wx", 0o600);
			try { await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`); await file.sync(); }
			finally { await file.close(); }
			await rename(temporary, join(this.directory, "tool-settings.json"));
		} catch { throw new ToolSettingsError(); }
		finally { await rm(temporary, { force: true }).catch(() => {}); }
	}
	private async mark(): Promise<void> {
		try {
			const marker = await open(join(this.directory, "tool-settings.initialized"), "wx", 0o600);
			try { await marker.writeFile("1\n"); await marker.sync(); } finally { await marker.close(); }
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ToolSettingsError(); }
	}
	private async load(): Promise<PolicySnapshot> {
		let json: string;
		try { json = await readFile(join(this.directory, "tool-settings.json"), "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || this.observed) throw new ToolSettingsError();
			try { await stat(join(this.directory, "tool-settings.initialized")); }
			catch (markerError) {
				if ((markerError as NodeJS.ErrnoException).code !== "ENOENT") throw new ToolSettingsError();
				await this.mark(); // Must survive an interrupted initial write.
				const initial = createPolicyDefaults(randomUUID(), this.inventory, this.plugins);
				await this.write(initial);
				this.observed = true;
				return initial;
			}
			throw new ToolSettingsError();
		}
		this.observed = true;
		const decoded = decodeToolPolicy(json);
		if (!decoded.ok) throw new ToolSettingsError();
		// Restore a deleted marker while the settings themselves remain readable.
		await this.mark();
		const missing = this.inventory.filter(tool => !Object.hasOwn(decoded.snapshot.tools, tool.id));
		const defaults = parentDefaults(this.plugins);
		const missingParents = Object.keys(defaults).filter(id => !Object.hasOwn(decoded.snapshot.parents, id));
		const missingCredentials = this.plugins.filter(plugin => plugin.credential && !Object.hasOwn(decoded.snapshot.credentials, plugin.id));
		if (decoded.migrated || missing.length || missingParents.length || missingCredentials.length) {
			if (decoded.snapshot.revision === Number.MAX_SAFE_INTEGER) throw new ToolSettingsError();
			decoded.snapshot.revision++;
			for (const tool of missing) decoded.snapshot.tools[tool.id] = { enabled: true, enabledAt: decoded.snapshot.revision };
			for (const id of missingParents) decoded.snapshot.parents[id] = { enabled: defaults[id], enabledAt: decoded.snapshot.revision };
			for (const plugin of missingCredentials) decoded.snapshot.credentials[plugin.id] = { generation: 0, reference: null };
			await this.write(decoded.snapshot);
		}
		return decoded.snapshot;
	}
	/** Keep callbacks short. Provider, backend and protected-store work belongs outside this lock. */
	withSnapshot<T>(fn: (snapshot: PolicySnapshot) => T | Promise<T>): Promise<T> {
		return this.locked(async () => fn(await this.load()));
	}
	read(): Promise<PolicySnapshot> { return this.withSnapshot(snapshot => snapshot); }
	transition(fn: (snapshot: PolicySnapshot) => PolicyUpdate): Promise<PolicyUpdate> {
		return this.locked(async () => {
			const result = fn(await this.load());
			if (result.ok) await this.write(result.snapshot);
			return result;
		});
	}
	update(expected: PolicyVersion, patch: PolicyPatch): Promise<PolicyUpdate> {
		return this.transition(snapshot => {
			const installed = patch.target === "parents" ? Object.hasOwn(parentDefaults(this.plugins), patch.id) : this.inventory.some(tool => tool.id === patch.id);
			return installed ? patchPolicy(snapshot, expected, patch) : { ok: false, code: "invalid-update", snapshot };
		});
	}
	reset(expected: PolicyVersion): Promise<PolicyUpdate> {
		return this.transition(snapshot => resetToolPolicy(snapshot, expected, this.inventory, this.plugins));
	}
	repair(): Promise<PolicySnapshot> {
		return this.locked(async () => {
			// Preserve the damaged file for investigation; never adopt its protected entry.
			try {
				const damaged = await readFile(join(this.directory, "tool-settings.json"));
				// A stale recovery dialog must not erase a now-healthy policy. Use revisioned reset instead.
				if (decodeToolPolicy(damaged.toString("utf8")).ok) throw new ToolSettingsError();
				const backup = await open(join(this.directory, `tool-settings.damaged.${randomUUID()}.json`), "wx", 0o600);
				try { await backup.writeFile(damaged); await backup.sync(); } finally { await backup.close(); }
			} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ToolSettingsError(); }
			await this.mark();
			const snapshot = createPolicyDefaults(randomUUID(), this.inventory, this.plugins);
			await this.write(snapshot);
			this.observed = true;
			return snapshot;
		});
	}
	subscribe(listener: (snapshot: PolicySnapshot | null) => void): () => void {
		if (this.closed) throw new ToolSettingsError();
		this.listeners.add(listener);
		if (!this.timer) {
			this.timer = setInterval(() => { void this.poll(); }, 400);
			this.timer.unref();
			void this.poll();
		}
		return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.stopWatching(); this.notified = undefined; } };
	}
	private async poll(): Promise<void> {
		if (this.polling || this.closed) return;
		this.polling = true;
		try {
			const snapshot = await this.read().catch(() => null);
			const version = snapshot ? `${snapshot.epoch}:${snapshot.revision}` : "unavailable";
			if (version !== this.notified) {
				this.notified = version;
				for (const listener of this.listeners) { try { listener(snapshot); } catch { /* Observers cannot break polling. */ } }
			}
		} finally { this.polling = false; }
	}
	private stopWatching(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
	async close(): Promise<void> {
		this.closed = true;
		this.stopWatching();
		this.listeners.clear();
		await Promise.allSettled([...this.operations]);
	}
}
