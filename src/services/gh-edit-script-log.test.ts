import assert from "node:assert/strict";
import { test } from "vitest";
import {
	formatPatchOp,
	sanitizeGhEditScriptItem,
	summarizeGhEditScriptItem,
} from "./gh-edit-script-log.js";

test("summarizeGhEditScriptItem covers all actions", () => {
	assert.match(
		summarizeGhEditScriptItem({
			action: "create",
			x: 10,
			y: 20,
			language: "csharp",
			scriptParts: { runScript: "a = 1;\n", references: ["System"] },
			inputs: [{ name: "x", typeHint: "double" }],
		}),
		/create csharp @\(10,20\) scriptParts/,
	);

	assert.match(
		summarizeGhEditScriptItem({
			action: "setCode",
			targetId: "abc",
			code: "print('hi')",
		}),
		/setCode target=abc code\(11c, 1L\)/,
	);

	assert.equal(
		summarizeGhEditScriptItem({
			action: "patchCode",
			targetId: "abc",
			scope: "runScriptBody",
			patches: [{ op: "delete", startLine: 2, endLine: 4 }],
		}),
		"patchCode target=abc scope=runScriptBody [delete L2-4]",
	);

	assert.equal(
		summarizeGhEditScriptItem({ action: "getCode", targetId: "abc" }),
		"getCode target=abc",
	);
});

test("formatPatchOp", () => {
	assert.equal(
		formatPatchOp({ op: "insert", afterLine: 0, lines: ["a", "b"] }),
		"insert after L0 (+2L)",
	);
	assert.equal(
		formatPatchOp({ op: "replace", startLine: 1, endLine: 3, lines: ["x"] }),
		"replace L1-3 → 1L",
	);
});

test("sanitizeGhEditScriptItem redacts code bodies", () => {
	const sanitized = sanitizeGhEditScriptItem({
		action: "setCode",
		targetId: "abc",
		code: "line1\nline2\nline3",
	});
	assert.deepEqual(sanitized.code, { chars: 17, lines: 3 });
	assert.equal("code" in sanitized && typeof sanitized.code === "string", false);
});
