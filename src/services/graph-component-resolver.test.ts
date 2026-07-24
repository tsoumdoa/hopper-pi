import assert from "node:assert/strict";
import { test } from "vitest";
import type { GhComponentInfo } from "../types/messages.js";
import { toShortTypeGuid } from "./guid-shortener.js";
import { resolveGraphComponentType } from "./graph-component-resolver.js";

function component(name: string, pluginName: string, typeGuid: string): GhComponentInfo {
	return {
		name,
		pluginName,
		typeGuid,
		assemblyName: `${pluginName}.gha`,
		category: "Test",
		subcategory: "Test",
		description: "",
	};
}

const ADD_GUID = "11111111-1111-1111-1111-111111111111";
const NATIVE_MERGE_GUID = "22222222-2222-2222-2222-222222222222";
const PLUGIN_MERGE_GUID = "33333333-3333-3333-3333-333333333333";
const REGISTRY = [
	component("Addition", "Grasshopper", ADD_GUID),
	component("Merge", "Grasshopper", NATIVE_MERGE_GUID),
	component("Merge", "Acme", PLUGIN_MERGE_GUID),
];

test("resolves exact names and plugin-qualified names case-insensitively", () => {
	assert.deepEqual(resolveGraphComponentType(REGISTRY, "addition", "type"), {
		ok: true,
		typeGuid: ADD_GUID,
	});
	assert.deepEqual(resolveGraphComponentType(REGISTRY, "ACME/merge", "type"), {
		ok: true,
		typeGuid: PLUGIN_MERGE_GUID,
	});
});

test("resolves registered short and full type GUIDs", () => {
	const short = toShortTypeGuid(ADD_GUID);
	assert.deepEqual(resolveGraphComponentType(REGISTRY, short, "type"), {
		ok: true,
		typeGuid: ADD_GUID,
	});
	assert.deepEqual(resolveGraphComponentType(REGISTRY, `{${ADD_GUID}}`, "type"), {
		ok: true,
		typeGuid: ADD_GUID,
	});
});

test("returns candidates for ambiguous exact names and rejects fuzzy names", () => {
	const ambiguous = resolveGraphComponentType(REGISTRY, "Merge", "components[0].type");
	assert.equal(ambiguous.ok, false);
	if (!ambiguous.ok) {
		assert.equal(ambiguous.error.code, "TYPE_AMBIGUOUS");
		assert.equal(ambiguous.error.candidates?.length, 2);
		assert.match(ambiguous.error.candidates?.[0] ?? "", /Grasshopper\/Merge/);
	}

	const missing = resolveGraphComponentType(REGISTRY, "Add", "components[0].type");
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.error.code, "TYPE_NOT_FOUND");
});
