import { TOOL_PLUGINS } from "../plugins/registry.js";
import { BUILTIN_GROUPS, type ToolPlugin } from "../plugins/types.js";

/** Pure policy transitions. Callers must supply an authoritative snapshot under the
 * shared store lock; this module does not provide persistence or execution guards. */
export type ToolRequirement = "backend" | "images" | "ui" | "credential";
export type ToolPolicyDescriptor = {
	id: string;
	name: string;
	owner: string;
	parent: string;
	defaultActive: boolean;
	requirements: readonly ToolRequirement[];
};
export function parentDefaults(plugins: readonly ToolPlugin[] = TOOL_PLUGINS): Record<string, boolean> {
	return Object.fromEntries([
		...Object.entries(BUILTIN_GROUPS).map(([id, group]) => [id, group.enabled]),
		...plugins.map(plugin => [plugin.id, plugin.defaultEnabled]),
	]);
}
export type Gate = { enabled: boolean; enabledAt: number };
export type PolicySnapshot = {
	schemaVersion: 2;
	epoch: string;
	revision: number;
	parents: Record<string, Gate>;
	tools: Record<string, Gate>;
	credentials: Record<string, { generation: number; reference: string | null }>;
};
export type PolicyVersion = Pick<PolicySnapshot, "epoch" | "revision">;
export type PolicyPatch = { target: "parents" | "tools"; id: string; enabled: boolean };
export type PolicyUpdate =
	| { ok: true; snapshot: PolicySnapshot }
	| { ok: false; code: "conflict" | "invalid-update"; snapshot: PolicySnapshot };

export function createPolicyDefaults(epoch: string, inventory: readonly ToolPolicyDescriptor[], plugins: readonly ToolPlugin[] = TOOL_PLUGINS): PolicySnapshot {
	if (!epoch) throw new Error("A policy epoch is required");
	assertPolicyInventory(inventory, plugins);
	return {
		schemaVersion: 2, epoch, revision: 0,
		parents: Object.fromEntries(Object.entries(parentDefaults(plugins)).map(([id, enabled]) => [id, { enabled, enabledAt: 0 }])),
		tools: Object.fromEntries(inventory.map(({ id }) => [id, { enabled: true, enabledAt: 0 }])),
		credentials: Object.fromEntries(plugins.filter(plugin => plugin.credential).map(plugin => [plugin.id, { generation: 0, reference: null }])),
	};
}

export function assertPolicyInventory(inventory: readonly ToolPolicyDescriptor[], plugins: readonly ToolPlugin[] = TOOL_PLUGINS): void {
	const ids = new Set<string>();
	const names = new Set<string>();
	const parents = parentDefaults(plugins);
	for (const tool of inventory) {
		if (!/^[a-z][a-z0-9_.-]*$/.test(tool.id) || ["constructor", "prototype"].includes(tool.id)
			|| !tool.name || !tool.owner || ids.has(tool.id) || names.has(tool.name)
			|| !Object.hasOwn(parents, tool.parent)) {
			throw new Error("Invalid or conflicting tool policy registration");
		}
		ids.add(tool.id);
		names.add(tool.name);
	}
}

function matches(current: PolicySnapshot, expected: PolicyVersion): boolean {
	return current.epoch === expected.epoch && current.revision === expected.revision;
}

/** A rejected update is never replayed, including changes to unrelated fields. */
export function patchPolicy(current: PolicySnapshot, expected: PolicyVersion, patch: PolicyPatch): PolicyUpdate {
	if (!matches(current, expected)) return { ok: false, code: "conflict", snapshot: current };
	if ((patch.target !== "parents" && patch.target !== "tools") || typeof patch.enabled !== "boolean"
		|| !Object.hasOwn(current[patch.target], patch.id) || current.revision === Number.MAX_SAFE_INTEGER) {
		return { ok: false, code: "invalid-update", snapshot: current };
	}
	const next = structuredClone(current);
	next.revision++;
	const gate = next[patch.target][patch.id];
	if (patch.enabled && !gate.enabled) gate.enabledAt = next.revision;
	gate.enabled = patch.enabled;
	return { ok: true, snapshot: next };
}

/** Invoke after saving a NEW protected entry, never with the API key itself. */
export function publishPluginCredential(
	current: PolicySnapshot, expected: PolicyVersion & { generation: number },
	reference: string, enable: boolean, pluginId: string,
): PolicyUpdate {
	if (!Object.hasOwn(current.credentials, pluginId) || !Object.hasOwn(current.parents, pluginId)) return { ok: false, code: "invalid-update", snapshot: current };
	if (!matches(current, expected) || current.credentials[pluginId].generation !== expected.generation) {
		return { ok: false, code: "conflict", snapshot: current };
	}
	// Opaque UUIDs prevent accidentally publishing a key or backend error as a reference.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)
		|| reference === current.credentials[pluginId].reference || typeof enable !== "boolean"
		|| current.revision === Number.MAX_SAFE_INTEGER
		|| expected.generation === Number.MAX_SAFE_INTEGER) {
		return { ok: false, code: "invalid-update", snapshot: current };
	}
	const next = structuredClone(current);
	next.revision++;
	next.credentials[pluginId] = { reference, generation: expected.generation + 1 };
	if (enable && !next.parents[pluginId].enabled) {
		next.parents[pluginId] = { enabled: true, enabledAt: next.revision };
	}
	return { ok: true, snapshot: next };
}

/** Commit this tombstone before attempting protected-store deletion. */
export function removePluginCredential(current: PolicySnapshot, expected: PolicyVersion, pluginId: string): PolicyUpdate {
	if (!Object.hasOwn(current.credentials, pluginId)) return { ok: false, code: "invalid-update", snapshot: current };
	if (!matches(current, expected)) return { ok: false, code: "conflict", snapshot: current };
	if (current.revision === Number.MAX_SAFE_INTEGER || current.credentials[pluginId].generation === Number.MAX_SAFE_INTEGER) {
		return { ok: false, code: "invalid-update", snapshot: current };
	}
	const next = structuredClone(current);
	next.revision++;
	next.credentials[pluginId] = { reference: null, generation: current.credentials[pluginId].generation + 1 };
	return { ok: true, snapshot: next };
}

/** Normal reset preserves the epoch and tombstones keys. Unreadable-store repair
 * must create a new epoch through createPolicyDefaults while holding the store lock. */
export function resetToolPolicy(current: PolicySnapshot, expected: PolicyVersion, inventory: readonly ToolPolicyDescriptor[], plugins: readonly ToolPlugin[] = TOOL_PLUGINS): PolicyUpdate {
	if (!matches(current, expected)) return { ok: false, code: "conflict", snapshot: current };
	if (current.revision === Number.MAX_SAFE_INTEGER || Object.values(current.credentials).some(credential => credential.generation === Number.MAX_SAFE_INTEGER)) {
		return { ok: false, code: "invalid-update", snapshot: current };
	}
	const next = createPolicyDefaults(current.epoch, inventory, plugins);
	next.revision = current.revision + 1;
	// Preserve retired preferences; reset affects installed tools and disconnects all keys.
	next.parents = { ...current.parents, ...next.parents };
	next.tools = { ...current.tools, ...next.tools };
	for (const id of Object.keys(parentDefaults(plugins))) next.parents[id].enabledAt = next.revision;
	for (const tool of inventory) next.tools[tool.id].enabledAt = next.revision;
	for (const [id, credential] of Object.entries(current.credentials)) next.credentials[id] = { reference: null, generation: credential.generation + 1 };
	return { ok: true, snapshot: next };
}

export type PolicyStatus = "disabled-by-user" | "parent-disabled" | "api-key-required"
	| "images-required" | "backend-unavailable" | "ui-unavailable" | "settings-unavailable"
	| "credential-store-unavailable" | "available-on-demand" | "activation-required" | "active" | "pending-exposure";
export type PolicyRuntime = {
	backend: boolean;
	images: boolean;
	ui: boolean;
	credentials: Record<string, { status: "configured" | "missing" | "unavailable"; generation?: number }>;
};
export type PolicySession = {
	epoch: string;
	appliedRevision: number;
	activeIds: ReadonlySet<string>;
};
export type ToolPolicyState = { enabled: boolean; available: boolean; active: boolean; callable: boolean; status: PolicyStatus };

function permission(tool: ToolPolicyDescriptor, policy: PolicySnapshot | null): PolicyStatus | null {
	if (!policy || !Object.hasOwn(policy.tools, tool.id) || !Object.hasOwn(policy.parents, tool.parent)) return "settings-unavailable";
	if (!policy.tools[tool.id].enabled) return "disabled-by-user";
	if (!policy.parents[tool.parent].enabled) return "parent-disabled";
	return null;
}

function requirement(tool: ToolPolicyDescriptor, policy: PolicySnapshot, runtime: PolicyRuntime): PolicyStatus | null {
	for (const gate of tool.requirements) {
		if (gate === "backend" && !runtime.backend) return "backend-unavailable";
		if (gate === "images" && !runtime.images) return "images-required";
		if (gate === "ui" && !runtime.ui) return "ui-unavailable";
		if (gate === "credential") {
			const saved = policy.credentials[tool.owner];
			const credential = runtime.credentials[tool.owner];
			if (!saved?.reference || credential?.status === "missing") return "api-key-required";
			if (credential?.status !== "configured" || credential.generation !== saved.generation) return "credential-store-unavailable";
		}
	}
	return null;
}

/** Preflight deliberately ignores cached backend status so an allowed call can recover it. */
export function checkPolicyPreflight(tool: ToolPolicyDescriptor, policy: PolicySnapshot | null, session: PolicySession): PolicyStatus | null {
	const denied = permission(tool, policy);
	if (denied || !policy) return denied ?? "settings-unavailable";
	if (session.epoch !== policy.epoch || session.appliedRevision > policy.revision) return "settings-unavailable";
	if (Math.max(policy.tools[tool.id].enabledAt, policy.parents[tool.parent].enabledAt) > session.appliedRevision) return "pending-exposure";
	if (!session.activeIds.has(tool.id)) return "activation-required";
	return null;
}

/** Re-evaluate against the latest locked snapshot immediately before EACH dispatch. */
export function resolveToolPolicy(
	tool: ToolPolicyDescriptor, policy: PolicySnapshot | null, runtime: PolicyRuntime,
	session: PolicySession, discoveryEnabled: boolean,
): ToolPolicyState {
	const denied = permission(tool, policy);
	const missing = !denied && policy ? requirement(tool, policy, runtime) : null;
	const exposure = !denied && !missing ? checkPolicyPreflight(tool, policy, session) : null;
	const status = denied ?? missing ?? (exposure === "activation-required"
		? discoveryEnabled ? "available-on-demand" : "activation-required"
		: exposure) ?? "active";
	return {
		enabled: !denied,
		available: !!policy && denied !== "settings-unavailable" && !requirement(tool, policy, runtime),
		active: session.activeIds.has(tool.id), callable: status === "active", status,
	};
}

/** Called only at a model-request boundary. Manual IDs belong to one session generation. */
export function reconcilePolicySession(
	inventory: readonly ToolPolicyDescriptor[], policy: PolicySnapshot, runtime: PolicyRuntime,
	progressive: boolean, manualIds: ReadonlySet<string> = new Set(),
): PolicySession {
	return {
		epoch: policy.epoch, appliedRevision: policy.revision,
		activeIds: new Set(inventory.filter(tool => !permission(tool, policy) && !requirement(tool, policy, runtime)
			&& (!progressive || tool.defaultActive || manualIds.has(tool.id))).map(tool => tool.id)),
	};
}
