import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { publishPluginCredential, removePluginCredential, type PolicySnapshot, type PolicyUpdate, type PolicyVersion } from "./tool-policy.js";
import { ToolPolicyStore } from "./tool-policy-store.js";

export class ToolCredentialError extends Error {
	constructor(readonly code: "credential-store-unavailable" | "invalid-key") {
		super(code === "invalid-key" ? "Enter a valid API key." : "Protected credential storage is unavailable. Unlock the credential store and try again.");
	}
}
export interface ProtectedCredentialBackend {
	read(reference: string): Promise<string | null>;
	write(reference: string, secret: string): Promise<void>;
	remove(reference: string): Promise<void>;
}

/** libsecret receives the password on stdin, never in command arguments or shell text. */
function secretTool(args: string[], secret?: string, allowMissing = false): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let output = "";
		let hasErrorOutput = false;
		child.stderr.on("data", () => { hasErrorOutput = true; });
		const timer = setTimeout(() => { child.kill(); reject(new ToolCredentialError("credential-store-unavailable")); }, 15_000);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", chunk => {
			output += chunk;
			if (output.length > 8192) { child.kill(); reject(new ToolCredentialError("credential-store-unavailable")); }
		});
		child.stdin.on("error", () => {});
		child.on("error", () => { clearTimeout(timer); reject(new ToolCredentialError("credential-store-unavailable")); });
		child.on("close", code => {
			clearTimeout(timer);
			if (code === 0) resolve(output.replace(/\n$/, ""));
			else if (allowMissing && code === 1 && !hasErrorOutput && !output) resolve("");
			else reject(new ToolCredentialError("credential-store-unavailable"));
		});
		child.stdin.end(secret);
	});
}

export function protectedCredentialBackend(directory: string, pluginId: string): ProtectedCredentialBackend {
	const service = `hopper-pi.${pluginId}.${createHash("sha256").update(directory).digest("hex")}`;
	if (process.platform === "linux") {
		return {
			read: async reference => (await secretTool(["lookup", "service", service, "account", reference], undefined, true)) || null,
			write: async (reference, secret) => { await secretTool(["store", `--label=Hopper ${pluginId} API key`, "service", service, "account", reference], secret); },
			remove: async reference => { await secretTool(["clear", "service", service, "account", reference]); },
		};
	}
	const entry = async (reference: string) => {
		if (process.platform !== "darwin" && process.platform !== "win32") throw new ToolCredentialError("credential-store-unavailable");
		const { AsyncEntry } = await import("@napi-rs/keyring");
		return new AsyncEntry(service, reference);
	};
	return {
		read: async reference => (await (await entry(reference)).getPassword()) ?? null,
		write: async (reference, secret) => { await (await entry(reference)).setPassword(secret); },
		remove: async reference => { await (await entry(reference)).deleteCredential(); },
	};
}

export type CredentialStatus = "configured" | "missing" | "unavailable";
export class ToolCredentials {
	private readonly backend: ProtectedCredentialBackend;
	private readonly pendingDeletion = new Set<string>();
	constructor(readonly store: ToolPolicyStore, readonly pluginId: string, backend?: ProtectedCredentialBackend) {
		if (!store.plugins.some(plugin => plugin.id === pluginId && plugin.credential)) throw new ToolCredentialError("invalid-key");
		this.backend = backend ?? protectedCredentialBackend(store.directory, pluginId);
	}
	/** Internal only. Callers must compare epoch, generation and reference again under admission lock. */
	async read(snapshot: PolicySnapshot): Promise<string | null> {
		const reference = snapshot.credentials[this.pluginId].reference;
		if (!reference) return null;
		try { return await this.backend.read(reference); }
		catch { throw new ToolCredentialError("credential-store-unavailable"); }
	}
	async status(snapshot: PolicySnapshot): Promise<CredentialStatus> {
		try { return await this.read(snapshot) ? "configured" : "missing"; }
		catch { return "unavailable"; }
	}
	async save(expected: PolicyVersion, key: string, enable: boolean): Promise<PolicyUpdate> {
		if (typeof key !== "string" || !key.trim() || key.length > 4096 || /[\r\n\0]/.test(key)) throw new ToolCredentialError("invalid-key");
		const starting = await this.store.read();
		if (starting.epoch !== expected.epoch || starting.revision !== expected.revision) return { ok: false, code: "conflict", snapshot: starting };
		const reference = randomUUID();
		try { await this.backend.write(reference, key.trim()); }
		catch { await this.cleanup(reference); throw new ToolCredentialError("credential-store-unavailable"); }
		let result: PolicyUpdate;
		try {
			result = await this.store.transition(current => publishPluginCredential(current,
				{ ...expected, generation: starting.credentials[this.pluginId].generation }, reference, enable, this.pluginId));
		} catch (error) { await this.cleanup(reference); throw error; }
		if (!result.ok) await this.cleanup(reference);
		else if (starting.credentials[this.pluginId].reference) await this.cleanup(starting.credentials[this.pluginId].reference!);
		return result;
	}
	async remove(expected: PolicyVersion): Promise<PolicyUpdate & { deletionFailed?: boolean }> {
		let reference: string | null = null;
		const result = await this.store.transition(current => {
			reference = current.credentials[this.pluginId].reference;
			return removePluginCredential(current, expected, this.pluginId);
		});
		if (!result.ok) return result;
		if (reference) this.pendingDeletion.add(reference);
		for (const pending of this.pendingDeletion) {
			try { await this.backend.remove(pending); this.pendingDeletion.delete(pending); } catch { /* Tombstone remains authoritative. */ }
		}
		return { ...result, ...(this.pendingDeletion.size ? { deletionFailed: true } : {}) };
	}
	private async cleanup(reference: string): Promise<void> {
		try { await this.backend.remove(reference); } catch { this.pendingDeletion.add(reference); }
	}
}
