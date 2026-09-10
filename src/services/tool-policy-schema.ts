import { BUILTIN_GROUPS } from "../plugins/types.js";
import { type PolicySnapshot } from "./tool-policy.js";

export type PolicyDecodeResult = { ok: true; snapshot: PolicySnapshot; migrated?: true }
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

/** Validate storage independently of the installed tool catalog. Missing catalog
 * entries are added under the store lock; retired entries retain their preferences. */
export function decodeToolPolicy(json: string): PolicyDecodeResult {
	const invalid = { ok: false, code: "invalid-settings" } as const;
	let value: unknown;
	try { value = JSON.parse(json); } catch { return invalid; }
	if (!record(value)) return invalid;
	if (counter(value.schemaVersion) && value.schemaVersion !== 1 && value.schemaVersion !== 2) return { ok: false, code: "unsupported-schema" };
	if (!keys(value, ["schemaVersion", "epoch", "revision", "parents", "tools", "credentials"])
		|| (value.schemaVersion !== 1 && value.schemaVersion !== 2) || typeof value.epoch !== "string" || !value.epoch || value.epoch.length > 128
		|| !counter(value.revision) || !record(value.parents) || !record(value.tools)
		|| !Object.keys(BUILTIN_GROUPS).every(id => Object.hasOwn(value.parents as object, id))) return invalid;
	for (const gate of [...Object.values(value.parents), ...Object.values(value.tools)]) {
		if (!record(gate) || !keys(gate, ["enabled", "enabledAt"]) || typeof gate.enabled !== "boolean"
			|| !counter(gate.enabledAt) || gate.enabledAt > value.revision) return invalid;
	}
	if (!record(value.credentials)) return invalid;
	for (const map of [value.parents, value.tools, value.credentials]) {
		if (Object.keys(map).some(id => !/^[a-z][a-z0-9_.-]*$/.test(id) || ["constructor", "prototype"].includes(id))) return invalid;
	}
	for (const credential of Object.values(value.credentials)) {
		if (!record(credential) || !keys(credential, ["generation", "reference"]) || !counter(credential.generation)
			|| credential.generation > value.revision
			|| (credential.reference !== null && credential.generation === 0)
			|| (credential.reference !== null && (typeof credential.reference !== "string"
				|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credential.reference)))) return invalid;
	}
	if (value.schemaVersion === 1) {
		// The old format had one provider. Preserve its protected-store reference exactly.
		if (!keys(value.parents, [...Object.keys(BUILTIN_GROUPS), "firecrawl"])
			|| !keys(value.credentials, ["firecrawl"])) return invalid;
		value.schemaVersion = 2;
		return { ok: true, snapshot: value as PolicySnapshot, migrated: true };
	}
	return { ok: true, snapshot: value as PolicySnapshot };
}
