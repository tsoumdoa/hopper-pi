import assert from "node:assert/strict";
import {
	assembleCsharpScript,
	parseCsharpScript,
} from "./csharp-script-assembler.js";
import { applyPatchesToScript } from "./csharp-script-patcher.js";
import { validateCsharpScript } from "./csharp-script-validator.js";

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

console.log("csharp-script-assembler tests passed");
