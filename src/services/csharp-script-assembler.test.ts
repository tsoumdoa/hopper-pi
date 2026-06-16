import assert from "node:assert/strict";
import { test } from "vitest";
import {
	assembleCsharpScript,
	parseCsharpScript,
} from "./csharp-script-assembler.js";
import { applyPatchesToScript } from "./csharp-script-patcher.js";
import { validateCsharpScript } from "./csharp-script-validator.js";

test("csharp-script-assembler", () => {
	const SAMPLE = assembleCsharpScript({
		references: ["System", "Rhino.Geometry"],
		runScript: `private void RunScript(
  double x,
  ref double a
)
{
  a = x * 2;
}`,
	});

	assert.match(SAMPLE, /public class Script_Instance : GH_ScriptInstance/);
	assert.match(SAMPLE, /using System;/);
	assert.match(SAMPLE, /a = x \* 2;/);

	const parsed = parseCsharpScript(SAMPLE);
	assert.ok(parsed);
	assert.deepEqual(parsed.references, ["System", "Rhino.Geometry"]);
	assert.match(parsed.runScript, /private void RunScript/);
	assert.equal(parsed.runScriptBody.trim(), "a = x * 2;");

	const roundTrip = assembleCsharpScript(parsed);
	assert.equal(validateCsharpScript(roundTrip).valid, true);

	const patched = applyPatchesToScript(SAMPLE, [
		{ op: "replace", startLine: 1, endLine: 1, lines: ["a = x * 3;"] },
	]);
	assert.match(patched, /a = x \* 3;/);
	assert.equal(validateCsharpScript(patched).valid, true);

	const inserted = applyPatchesToScript(SAMPLE, [
		{ op: "insert", afterLine: 0, lines: ["// scale input"] },
	]);
	assert.match(inserted, /\/\/ scale input/);
	assert.match(inserted, /a = x \* 2;/);
	assert.equal(validateCsharpScript(inserted).valid, true);
});

test("full scope patch removes trailing comments without breaking RunScript", () => {
	const code = assembleCsharpScript({
		references: ["System", "Rhino.Geometry"],
		runScript: `private void RunScript(
  double x, // input
  ref double a // output
)
{
  // Do work
  a = x * 2; // assign
}`,
		helpers: `// helper header
private double Scale(double v) { return v * 2; }`,
	});

	const lines = code.split("\n");
	const commentLinePatches = lines
		.map((line, index) => ({ line, lineNumber: index + 1 }))
		.filter(({ line }) => /\/\//.test(line))
		.map(({ line, lineNumber }) => ({
			op: "replace" as const,
			startLine: lineNumber,
			endLine: lineNumber,
			lines: [line.replace(/\s*\/\/.*$/, "").trimEnd()],
		}));

	const patched = applyPatchesToScript(code, commentLinePatches, "full");
	assert.equal(
		validateCsharpScript(patched).valid,
		true,
		`patched script should validate: ${patched}`,
	);
});

test("full scope multi-patch applies bottom-up so original line numbers stay valid", () => {
	const code = assembleCsharpScript({
		references: ["System", "Rhino.Geometry", "Grasshopper"],
		runScript: `private void RunScript(
  object tree, // tree input
  double tol, // tolerance
  ref object outTree // tree output
)
{
  // cast inputs
  var data = (DataTree<Point3d>)tree;

  // assign output
  outTree = data;
}`,
		helpers: `// helper header
private static bool IsValid(Point3d p)
{
  // check point
  return p.IsValid;
}

// another helper
private static double Distance(Point3d a, Point3d b)
{
  return a.DistanceTo(b);
}`,
	});

	const commentOnlyLines = code
		.split("\n")
		.map((line, index) => ({ line, lineNumber: index + 1 }))
		.filter(({ line }) => /^\s*\/\//.test(line))
		.map(({ lineNumber }) => lineNumber);

	const patched = applyPatchesToScript(
		code,
		commentOnlyLines.map((lineNumber) => ({
			op: "replace" as const,
			startLine: lineNumber,
			endLine: lineNumber,
			lines: [],
		})),
		"full",
	);

	assert.equal(validateCsharpScript(patched).valid, true);
});
