import assert from "node:assert/strict";
import { test } from "vitest";
import type { GhComponentInfo } from "../types/messages.js";
import {
	formatApplyGraphResult,
	normalizeApplyGraphInput,
	shortenApplyGraphRefs,
	validateApplyGraphInput,
} from "./gh-apply-graph.js";
import { resolveInstanceGuid } from "./guid-shortener.js";

const TYPE_GUID = "11111111-1111-1111-1111-111111111111";
const REGISTRY: { components: GhComponentInfo[] } = {
	components: [{
		name: "Addition",
		pluginName: "Grasshopper",
		typeGuid: TYPE_GUID,
		assemblyName: "Grasshopper",
		category: "Maths",
		subcategory: "Operators",
		description: "",
	}],
};

test("normalizes a minimal component-and-wire graph to full type GUIDs", async () => {
	const result = await normalizeApplyGraphInput({
		components: [
			{ ref: "a", type: "Addition", x: 100, y: 100 },
			{ ref: "b", type: "Addition", x: 300, y: 100 },
		],
		wires: [{ from: ["a", 0], to: ["b", "A"] }],
	}, REGISTRY);

	assert.equal(result.errors.length, 0);
	assert.equal(result.request?.components[0].typeGuid, TYPE_GUID);
	assert.deepEqual(result.request?.wires[0], { from: ["a", 0], to: ["b", "A"] });
});

test("normalizes every supported node kind and assembles C# script parts", async () => {
	const result = await normalizeApplyGraphInput({
		components: [{ ref: "add", type: "Grasshopper/Addition", x: 100, y: 100 }],
		widgets: [
			{ ref: "slider", kind: "slider", x: 100, y: 200, min: 0, max: 10, value: 2 },
			{ ref: "panel", kind: "panel", x: 100, y: 300, text: "hello" },
			{ ref: "toggle", kind: "toggle", x: 100, y: 400, value: true },
			{ ref: "swatch", kind: "swatch", x: 100, y: 500, color: "rgba(1,2,3,255)" },
			{ ref: "note", kind: "scribble", x: 100, y: 600, text: "note" },
			{
				ref: "choices",
				kind: "valueList",
				x: 100,
				y: 700,
				items: [{ name: "One", value: "1" }],
			},
		],
		scripts: [
			{
				ref: "cs",
				language: "csharp",
				x: 400,
				y: 100,
				scriptParts: {
					references: ["Rhino.Geometry"],
					runScript: "private void RunScript(double x, ref object A) { A = x; }",
					helpers: "private double Twice(double x) => x * 2;",
				},
				inputs: [{ name: "x", typeHint: "double" }],
				outputs: [{ name: "A" }],
			},
			{
				ref: "py",
				language: "python",
				x: 600,
				y: 100,
				code: "a = x",
			},
		],
		groups: [{ name: "Graph", refs: ["add", "cs", "py"] }],
	}, REGISTRY);

	assert.equal(result.errors.length, 0);
	assert.equal(result.request?.widgets.length, 6);
	assert.match(result.request?.scripts[0].code ?? "", /RunScript/);
	assert.match(result.request?.scripts[0].code ?? "", /Twice/);
	assert.equal(result.request?.scripts[1].code, "a = x");
});

test("validates refs, coordinates, dangling wires and groups, and script sources", () => {
	const errors = validateApplyGraphInput({
		components: [
			{ ref: "bad ref", type: "Addition", x: 10, y: 20 },
			{ ref: "dup", type: "Addition", x: 20, y: 20 },
		],
		widgets: [{ ref: "dup", kind: "toggle", x: 20, y: 20, value: true }],
		scripts: [
			{ ref: "py", language: "python", x: 20, y: 20, scriptParts: { runScript: "x" } },
			{ ref: "cs", language: "csharp", x: 20, y: 20, code: "x", scriptParts: { runScript: "x" } },
		],
		wires: [{ from: ["missing", 0], to: ["dup", 0] }],
		groups: [{ name: "", refs: ["alsoMissing"] }],
	});

	const codes = errors.map((error) => error.code);
	for (const expected of [
		"INVALID_REF",
		"INVALID_POSITION",
		"DUPLICATE_REF",
		"UNKNOWN_REF",
		"INVALID_GROUP",
		"INVALID_SCRIPT_SOURCE",
	]) {
		assert.ok(codes.includes(expected), `missing ${expected}`);
	}
});

test("rejects empty graphs before fetching a component registry", async () => {
	const result = await normalizeApplyGraphInput({});
	assert.deepEqual(result.errors.map((error) => error.code), ["EMPTY_GRAPH"]);
	assert.equal(result.request, undefined);
});

test("formats compact counts, refs, runtime messages, and overlaps", () => {
	const text = formatApplyGraphResult({
		ok: true,
		rolledBack: false,
		counts: { components: 2, widgets: 1, scripts: 0, wires: 2, groups: 1 },
		refs: { source: "a1B2", result: "c3D4" },
		structuralErrors: [],
		runtimeMessages: [
			{ componentId: "x", componentNickName: "A", level: "error", text: "bad" },
			{ componentId: "y", componentNickName: "B", level: "warning", text: "warn" },
		],
		overlaps: {
			hasOverlaps: true,
			componentOverlaps: [{
				componentA: "x",
				nickNameA: "A",
				componentB: "y",
				nickNameB: "B",
				intersectionArea: 20,
			}],
			groupOverlaps: [],
		},
		elapsedMs: 42,
	});

	assert.match(text, /2 components, 1 widgets, 0 scripts, 2 wires, 1 groups/);
	assert.match(text, /source=a1B2, result=c3D4/);
	assert.match(text, /1 errors, 1 warnings, 1 overlaps/);
	assert.doesNotMatch(text, /job/i);
});

test("registers backend instance GUIDs and returns compact ref IDs", () => {
	const full = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
	const refs = shortenApplyGraphRefs({ output: full });
	assert.match(refs.output, /^[0-9A-Za-z]{4,}$/);
	assert.equal(resolveInstanceGuid(refs.output), full);
});
