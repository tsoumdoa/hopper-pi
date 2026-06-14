import assert from "node:assert/strict";
import { test } from "vitest";
import { defaultPatchScope, validatePatchScope } from "./gh-edit-script-executor.js";

test("defaultPatchScope selects runScriptBody for C# and body for Python", () => {
	const csharp = "public class Script_Instance : GH_ScriptInstance { private void RunScript() {} }";
	assert.equal(defaultPatchScope(csharp), "runScriptBody");
	assert.equal(defaultPatchScope("import rhinoscriptsyntax as rs\nx = 1"), "body");
});

test("validatePatchScope rejects cross-language scopes", () => {
	const csharp = "public class Script_Instance : GH_ScriptInstance { private void RunScript() {} }";
	assert.match(validatePatchScope(csharp, "body") ?? "", /Python/);
	assert.match(validatePatchScope("x = 1", "runScriptBody") ?? "", /C#/);
});
