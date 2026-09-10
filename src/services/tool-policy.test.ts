import { describe, expect, it } from "vitest";
import {
	assertPolicyInventory, checkPolicyPreflight, createPolicyDefaults, patchPolicy,
	publishPluginCredential, reconcilePolicySession, removePluginCredential, resetToolPolicy, resolveToolPolicy,
	type PolicyRuntime, type PolicySnapshot, type PolicyUpdate,
} from "./tool-policy.js";
import { decodeToolPolicy } from "./tool-policy-schema.js";
import { HOPPER_POLICY_INVENTORY as inventory } from "../tools/policy-inventory.js";
import { HOPPER_REGISTERED_CATALOG } from "../tools/catalog.js";
import { toolPolicyProfileDirectory } from "./tool-policy-profile.js";

const runtime: PolicyRuntime = { backend: true, images: true, ui: true, credentials: { firecrawl: { status: "configured", generation: 1 } } };
const fresh = () => createPolicyDefaults("epoch-a", inventory);
const tool = (name: string) => inventory.find(entry => entry.name === name)!;
const unwrap = (result: PolicyUpdate): PolicySnapshot => {
	expect(result.ok).toBe(true);
	return result.snapshot;
};
const toggle = (policy: PolicySnapshot, target: "tools" | "parents", id: string, enabled: boolean) =>
	unwrap(patchPolicy(policy, policy, { target, id, enabled }));
const ref = "b0259729-a21f-4a31-872a-50f731ba48e5";
const configured = () => unwrap(publishPluginCredential(fresh(), { ...fresh(), generation: 0 }, ref, true, "firecrawl"));

describe("policy inventory and defaults", () => {
	it("covers the catalog and registrations outside it with unique identities", () => {
		for (const entry of HOPPER_REGISTERED_CATALOG) expect(tool(entry.tool.name)).toBeDefined();
		for (const name of ["rh_capture_view", "hopper_search_tools", "ask_user", "pick_option", "read", "web_search", "web_fetch"]) expect(tool(name)).toBeDefined();
		expect(tool("rh_capture_view").requirements).toEqual(["backend", "images"]);
		expect(() => assertPolicyInventory([...inventory, { ...tool("web_search"), id: "other.tool" }])).toThrow();
	});
	it("retains built-in defaults and blocks Firecrawl without disabling its children", () => {
		const policy = fresh();
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		for (const entry of inventory) {
			expect(policy.tools[entry.id].enabled).toBe(true);
			expect(resolveToolPolicy(entry, policy, runtime, session, true).callable).toBe(entry.owner === "hopper");
		}
	});
});

describe("permissions and model-request boundaries", () => {
	it("blocks an old definition immediately and keeps it blocked through re-enable", () => {
		const original = fresh();
		const session = reconcilePolicySession(inventory, original, runtime, false);
		const entry = tool("rh_run_script");
		const disabled = toggle(original, "tools", entry.id, false);
		expect(resolveToolPolicy(entry, disabled, runtime, session, true).status).toBe("disabled-by-user");
		expect(resolveToolPolicy(entry, disabled, runtime, session, true).active).toBe(true);
		expect(resolveToolPolicy(entry, disabled, runtime, session, true).callable).toBe(false);
		const enabled = toggle(disabled, "tools", entry.id, true);
		expect(resolveToolPolicy(entry, enabled, runtime, session, true).status).toBe("pending-exposure");
		expect(resolveToolPolicy(entry, enabled, runtime, reconcilePolicySession(inventory, enabled, runtime, false), true).callable).toBe(true);
		expect(original.tools[entry.id].enabledAt).toBe(0);
	});
	it("parent switches preserve child choices and prevent stale exposure after re-enable", () => {
		let policy = toggle(fresh(), "tools", tool("rh_query_objects").id, false);
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		policy = toggle(policy, "parents", "hopper.rhino", false);
		policy = toggle(policy, "parents", "hopper.rhino", true);
		expect(policy.tools[tool("rh_query_objects").id].enabled).toBe(false);
		expect(checkPolicyPreflight(tool("rh_run_script"), policy, session)).toBe("pending-exposure");
	});
	it("allows backend recovery before dispatch but rechecks a disable afterward", () => {
		const policy = fresh();
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		const entry = tool("rh_run_script");
		expect(checkPolicyPreflight(entry, policy, session)).toBeNull();
		expect(resolveToolPolicy(entry, policy, { ...runtime, backend: false }, session, true).status).toBe("backend-unavailable");
		const disabled = toggle(policy, "tools", entry.id, false);
		expect(resolveToolPolicy(entry, disabled, runtime, session, true).callable).toBe(false);
	});
	it("requires both backend and image input for capture", () => {
		const policy = fresh();
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		for (const missing of [{ backend: false }, { images: false }]) {
			expect(resolveToolPolicy(tool("rh_capture_view"), policy, { ...runtime, ...missing }, session, true).callable).toBe(false);
		}
	});
	it("supports manual specialist activation without discovery, but never bypasses switches", () => {
		const entry = tool("web_fetch");
		let policy = configured();
		let session = reconcilePolicySession(inventory, policy, runtime, true);
		expect(resolveToolPolicy(entry, policy, runtime, session, false).status).toBe("activation-required");
		session = reconcilePolicySession(inventory, policy, runtime, true, new Set([entry.id]));
		expect(resolveToolPolicy(entry, policy, runtime, session, false).callable).toBe(true);
		policy = toggle(policy, "parents", "firecrawl", false);
		expect(reconcilePolicySession(inventory, policy, runtime, true, new Set([entry.id])).activeIds.has(entry.id)).toBe(false);
	});
	it("rejects missing settings and sessions from a repaired epoch", () => {
		const policy = fresh();
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		expect(resolveToolPolicy(tool("rh_run_script"), null, runtime, session, true).status).toBe("settings-unavailable");
		expect(resolveToolPolicy(tool("rh_run_script"), { ...policy, epoch: "repaired" }, runtime, session, true).callable).toBe(false);
	});
});

describe("conditional updates and credential publication", () => {
	it("resets through a revisioned update and never adopts an old credential", () => {
		const original = configured();
		const session = reconcilePolicySession(inventory, original, runtime, false);
		const reset = unwrap(resetToolPolicy(original, original, inventory));
		expect(reset.revision).toBe(original.revision + 1);
		expect(reset.parents.firecrawl.enabled).toBe(false);
		expect(reset.credentials.firecrawl).toEqual({ generation: 2, reference: null });
		expect(checkPolicyPreflight(tool("rh_run_script"), reset, session)).toBe("pending-exposure");
		expect(resetToolPolicy(reset, original, inventory).ok).toBe(false);
	});
	it("rejects stale updates even for unrelated fields", () => {
		const original = fresh();
		const current = toggle(original, "parents", "hopper.rhino", false);
		const result = patchPolicy(current, original, { target: "parents", id: "firecrawl", enabled: true });
		expect(result).toEqual({ ok: false, code: "conflict", snapshot: current });
	});
	it("does not enable the plugin when only saving a key", () => {
		const policy = unwrap(publishPluginCredential(fresh(), { ...fresh(), generation: 0 }, ref, false, "firecrawl"));
		expect(policy.parents.firecrawl.enabled).toBe(false);
		expect(policy.credentials.firecrawl.reference).toBe(ref);
	});
	it("rejects publication after another host disables, removes, or resets", () => {
		const initial = configured();
		const expected = { ...initial, generation: initial.credentials.firecrawl.generation };
		const replacement = "8ef44ee7-f701-4a53-b30f-0d6598eb7da5";
		for (const current of [toggle(initial, "parents", "firecrawl", false), unwrap(removePluginCredential(initial, initial, "firecrawl")), createPolicyDefaults("new-epoch", inventory)]) {
			expect(publishPluginCredential(current, expected, replacement, true, "firecrawl")).toEqual({ ok: false, code: "conflict", snapshot: current });
		}
	});
	it("tombstones block cached credentials without changing plugin or child preferences", () => {
		const initial = configured();
		const session = reconcilePolicySession(inventory, initial, runtime, false);
		const removed = unwrap(removePluginCredential(initial, initial, "firecrawl"));
		expect(removed.parents).toEqual(initial.parents);
		expect(removed.tools).toEqual(initial.tools);
		expect(removed.credentials.firecrawl).toEqual({ generation: 2, reference: null });
		expect(resolveToolPolicy(tool("web_search"), removed, runtime, session, true).status).toBe("api-key-required");
	});
	it("blocks inaccessible or outdated protected entries", () => {
		const policy = configured();
		const session = reconcilePolicySession(inventory, policy, runtime, false);
		for (const changed of [{ credentials: { firecrawl: { status: "configured" as const, generation: 0 } } }, { credentials: { firecrawl: { status: "unavailable" as const } } }]) {
			expect(resolveToolPolicy(tool("web_search"), policy, { ...runtime, ...changed }, session, true).status).toBe("credential-store-unavailable");
		}
	});
});

describe("shared profile location", () => {
	it("uses application configuration paths rather than project or session state", () => {
		const base = { homeDir: "/users/test", env: {} };
		expect(toolPolicyProfileDirectory({ ...base, platform: "darwin" })).toBe("/users/test/Library/Application Support/hopper-pi");
		expect(toolPolicyProfileDirectory({ ...base, platform: "win32", env: { APPDATA: "/roaming" } })).toBe("/roaming/hopper-pi");
		expect(toolPolicyProfileDirectory({ ...base, platform: "linux" })).toBe("/users/test/.config/hopper-pi");
		expect(toolPolicyProfileDirectory({ ...base, platform: "linux", env: { XDG_CONFIG_HOME: "relative" } })).toBe("/users/test/.config/hopper-pi");
		expect(toolPolicyProfileDirectory({ ...base, configDirectory: "/profiles/other" })).toBe("/profiles/other");
		expect(() => toolPolicyProfileDirectory({ configDirectory: "relative" })).toThrow();
	});
});

describe("settings decoding", () => {
	it("round trips the schema and refuses corrupt, incomplete, future, or secret-bearing data", () => {
		const policy = fresh();
		expect(decodeToolPolicy(JSON.stringify(policy))).toEqual({ ok: true, snapshot: policy });
		for (const invalid of ["{sentinel-secret", "null", JSON.stringify({ ...policy, tools: null }), JSON.stringify({ ...policy, key: "sentinel-secret" }), JSON.stringify({ ...policy, revision: -1 })]) {
			expect(decodeToolPolicy(invalid)).toEqual({ ok: false, code: "invalid-settings" });
		}
		expect(decodeToolPolicy(JSON.stringify({ ...policy, schemaVersion: 3 }))).toEqual({ ok: false, code: "unsupported-schema" });
	});
	it("rejects invalid revisions, credential references, and malformed gates without echoing values", () => {
		const policy = fresh();
		policy.tools[tool("rh_run_script").id].enabledAt = 1;
		expect(decodeToolPolicy(JSON.stringify(policy)).ok).toBe(false);
		const result = publishPluginCredential(fresh(), { ...fresh(), generation: 0 }, "sentinel-secret", true, "firecrawl");
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).not.toContain("sentinel-secret");
		expect(patchPolicy(fresh(), fresh(), { target: "tools", id: "__proto__", enabled: true }).ok).toBe(false);
	});
});
