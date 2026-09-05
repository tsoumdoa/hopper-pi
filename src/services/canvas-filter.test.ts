import { expect, it } from "vitest";
import type { Component, Wire } from "../types/gh.js";
import { expandExcludedIds, filterCanvasBySelection } from "./canvas-filter.js";

function wire(from: string, to: string): Wire {
	return { from: `${from}.out`, to: `${to}.in`, sourceComponentGuid: from, targetPortGuid: to };
}

it.each([
	{ name: "excludes a node connected only to excluded nodes", edges: [["a", "b"]], expected: ["a", "b"] },
	{ name: "preserves nodes with a nonexcluded neighbor", edges: [["a", "b"], ["c", "a"]], expected: ["b"] },
	{ name: "preserves self-connected nodes", edges: [["a", "b"], ["a", "a"]], expected: ["b"] },
	{ name: "preserves disconnected nodes", edges: [["c", "d"]], expected: ["b"] },
])("$name", ({ edges, expected }) => {
	const initial = new Set(["b"]);
	const wires = edges.map(([from, to]) => wire(from, to));
	expect([...expandExcludedIds(wires, initial)].sort()).toEqual(expected);
	expect([...expandExcludedIds([...wires].reverse(), initial)].sort()).toEqual(expected);
	expect([...initial]).toEqual(["b"]);
});

it("selects nested group members, tolerates cycles, and removes external wires", () => {
	function component(id: string, members?: string[]): Component {
		return {
			id, type: members ? "Group" : "Component", typeGuid: "type", instanceGuid: id.toUpperCase(),
			nickName: id, inputs: {}, outputs: {}, members,
		};
	}
	const components = {
		outer: component("outer", ["inner", "a", "missing"]),
		inner: component("inner", ["outer", "b"]),
		a: component("a"),
		b: component("b"),
		c: component("c"),
	};
	const internal = wire("a", "b");
	const result = filterCanvasBySelection(
		{ components, wires: [internal, wire("b", "c")] },
		new Set(["outer"]),
	);
	expect(Object.keys(result.components).sort()).toEqual(["a", "b", "inner", "outer"]);
	expect(result.wires).toEqual([internal]);
	expect(Object.keys(components)).toHaveLength(5);
});
