import assert from "node:assert/strict";
import { test } from "vitest";
import type { Component } from "../types/gh.js";
import { expandExcludedIds, filterCanvasByComponentIds } from "./canvas-filter.js";

test("expandExcludedIds cascades exclusion to nodes only connected to excluded nodes", () => {
	const components: Record<string, Component> = {
		a: { id: "a", type: "A", typeGuid: "g1", instanceGuid: "i1", nickName: "a", inputs: {}, outputs: {} },
		b: { id: "b", type: "B", typeGuid: "g2", instanceGuid: "i2", nickName: "b", inputs: {}, outputs: {} },
		c: { id: "c", type: "C", typeGuid: "g3", instanceGuid: "i3", nickName: "c", inputs: {}, outputs: {} },
	};
	const wires = [
		{ from: "a.out", to: "b.in", sourceComponentGuid: "s1", targetPortGuid: "t1" },
		{ from: "c.out", to: "a.in", sourceComponentGuid: "s2", targetPortGuid: "t2" },
	];
	const excluded = expandExcludedIds(components, wires, new Set(["b"]));
	assert.ok(excluded.has("b"));
	assert.ok(!excluded.has("c"));
	assert.ok(!excluded.has("a"));
});

test("filterCanvasByComponentIds keeps only requested components and internal wires", () => {
	const components: Record<string, Component> = {
		a: { id: "a", type: "A", typeGuid: "g1", instanceGuid: "AAAA-1", nickName: "a", inputs: {}, outputs: {} },
		b: { id: "b", type: "B", typeGuid: "g2", instanceGuid: "BBBB-2", nickName: "b", inputs: {}, outputs: {} },
		c: { id: "c", type: "C", typeGuid: "g3", instanceGuid: "CCCC-3", nickName: "c", inputs: {}, outputs: {} },
	};
	const wires = [
		{ from: "a.out", to: "b.in", sourceComponentGuid: "s1", targetPortGuid: "t1" },
		{ from: "b.out", to: "c.in", sourceComponentGuid: "s2", targetPortGuid: "t2" },
	];

	const result = filterCanvasByComponentIds({ components, wires }, ["aaaa-1", "BBBB-2"]);

	assert.deepEqual(Object.keys(result.components).sort(), ["a", "b"]);
	assert.equal(result.wires.length, 1);
	assert.equal(result.wires[0].from, "a.out");
});

test("filterCanvasByComponentIds returns empty for unknown ids", () => {
	const components: Record<string, Component> = {
		a: { id: "a", type: "A", typeGuid: "g1", instanceGuid: "AAAA-1", nickName: "a", inputs: {}, outputs: {} },
	};
	const result = filterCanvasByComponentIds({ components, wires: [] }, ["ZZZZ-9"]);
	assert.deepEqual(Object.keys(result.components), []);
});
