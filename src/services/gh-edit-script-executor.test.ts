import assert from "node:assert/strict";
import { test } from "vitest";
import { applyLinePatches } from "./csharp-script-patcher.js";
import { defaultPatchScope, validatePatchScope } from "./gh-edit-script-executor.js";

test("defaultPatchScope selects runScriptBody for C# and full for Python", () => {
	const csharp = "public class Script_Instance : GH_ScriptInstance { private void RunScript() {} }";
	assert.equal(defaultPatchScope(csharp), "runScriptBody");
	assert.equal(defaultPatchScope("import rhinoscriptsyntax as rs\nx = 1"), "full");
});

test("validatePatchScope rejects cross-language scopes", () => {
	const csharp = "public class Script_Instance : GH_ScriptInstance { private void RunScript() {} }";
	const python = "import rhinoscriptsyntax as rs\nx = 1";

	assert.match(validatePatchScope(csharp, "body") ?? "", /not supported for C#/);
	assert.match(validatePatchScope(csharp, "imports") ?? "", /not supported for C#/);
	assert.match(validatePatchScope(python, "runScriptBody") ?? "", /C#/);
	assert.match(validatePatchScope(python, "body") ?? "", /no longer supported/);
	assert.match(validatePatchScope(python, "imports") ?? "", /no longer supported/);
	assert.equal(validatePatchScope(python, "full"), null);
});

test("applyLinePatches patches full Python source", () => {
	const code = "import math\n\na = x * 2";
	const patched = applyLinePatches(code, [
		{ op: "replace", startLine: 3, endLine: 3, lines: ["a = x * 3"] },
	]);
	assert.equal(patched, "import math\n\na = x * 3");
});
