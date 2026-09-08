import { PARENT_DEFAULTS, type PolicySnapshot, type ToolPolicyDescriptor } from "./tool-policy.js";

export type PolicyDecodeResult = { ok: true; snapshot: PolicySnapshot }
	| { ok: false; code: "invalid-settings" | "unsupported-schema" };

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
	return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function counter(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** No fallback to defaults, and no raw parser messages that might contain secrets.
 * There are no prior tool-settings schemas to migrate in this first version. */
export function decodeToolPolicy(json: string, inventory: readonly ToolPolicyDescriptor[]): PolicyDecodeResult {
	const invalid = { ok: false, code: "invalid-settings" } as const;
	let value: unknown;
	try { value = JSON.parse(json); } catch { return invalid; }
	if (!record(value)) return invalid;
	if (counter(value.schemaVersion) && value.schemaVersion !== 1) return { ok: false, code: "unsupported-schema" };
	if (!keys(value, ["schemaVersion", "epoch", "revision", "parents", "tools", "credentials"])
		|| value.schemaVersion !== 1 || typeof value.epoch !== "string" || !value.epoch || value.epoch.length > 128
		|| !counter(value.revision) || !record(value.parents) || !record(value.tools)
		|| !keys(value.parents, Object.keys(PARENT_DEFAULTS))
		|| !keys(value.tools, inventory.map(tool => tool.id))) return invalid;
	for (const gate of [...Object.values(value.parents), ...Object.values(value.tools)]) {
		if (!record(gate) || !keys(gate, ["enabled", "enabledAt"]) || typeof gate.enabled !== "boolean"
			|| !counter(gate.enabledAt) || gate.enabledAt > value.revision) return invalid;
	}
	if (!record(value.credentials) || !keys(value.credentials, ["firecrawl"])) return invalid;
	const credential = value.credentials.firecrawl;
	if (!record(credential) || !keys(credential, ["generation", "reference"]) || !counter(credential.generation)
		|| credential.generation > value.revision
		|| (credential.reference !== null && credential.generation === 0)
		|| (credential.reference !== null && (typeof credential.reference !== "string"
			|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credential.reference)))) return invalid;
	return { ok: true, snapshot: value as PolicySnapshot };
}
