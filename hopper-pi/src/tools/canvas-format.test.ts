import assert from "node:assert/strict";
import {
	appendWireBlock,
	formatCanvasHeaderLine,
	formatComponentDetailLines,
} from "./canvas-format.js";
import type { Component } from "../types/gh.js";

const sample: Component = {
	id: "c0",
	type: "Curve",
	typeGuid: "tg1",
	instanceGuid: "ig1",
	nickName: "Crv",
	inputs: {
		i0: { nick: "Curve", instanceGuid: "ip1" },
	},
	outputs: {
		o0: { nick: "Curve", instanceGuid: "op1", description: "A long description" },
	},
	visuals: { pivot: { x: 10, y: 20 } },
};

const text = formatComponentDetailLines("c0", sample).join("\n");
assert.match(text, /^c0 Crv Curve g=ig1$/m);
assert.match(text, /out: Curve p=op1/);
assert.match(text, /in: Curve p=ip1/);
assert.match(text, /@10,20/);
assert.doesNotMatch(text, /COMPONENT_GUID|PORT_GUID|OUTPUTS/);

const lines: string[] = [];
appendWireBlock(lines, [{ from: "a.o0", to: "b.i0" }]);
assert.equal(lines[0], "WIRES");
assert.match(lines[1], /a\.o0 -> b\.i0/);

assert.equal(formatCanvasHeaderLine("def.gh", 3, 2), "Canvas: def.gh (3c, 2w)");

console.log("canvas-format.test.ts: ok");
