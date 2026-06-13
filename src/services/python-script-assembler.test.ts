import assert from "node:assert/strict";
import { test } from "vitest";
import {
	assemblePythonScript,
	parsePythonScript,
} from "./python-script-assembler.js";
import { applyPatchesToPythonScript } from "./python-script-patcher.js";

test("python-script-assembler", () => {
	const SAMPLE = assemblePythonScript({
		imports: [
			"import rhinoscriptsyntax as rs",
			"import ghpythonlib.treehelpers as th",
		],
		body: "a = x * 2",
	});

	assert.match(SAMPLE, /import rhinoscriptsyntax as rs/);
	assert.match(SAMPLE, /a = x \* 2/);

	const parsed = parsePythonScript(SAMPLE);
	assert.ok(parsed);
	assert.equal(parsed.imports.length, 2);
	assert.equal(parsed.body.trim(), "a = x * 2");

	const roundTrip = assemblePythonScript(parsed);
	assert.equal(roundTrip, SAMPLE);

	const bodyPatched = applyPatchesToPythonScript(SAMPLE, [
		{ op: "replace", startLine: 1, endLine: 1, lines: ["a = x * 3"] },
	]);
	assert.match(bodyPatched, /a = x \* 3/);
	assert.doesNotMatch(bodyPatched, /a = x \* 2/);

	const importPatched = applyPatchesToPythonScript(SAMPLE, [
		{ op: "insert", afterLine: 2, lines: ["import math"] },
	], "imports");
	assert.match(importPatched, /import math/);

	const noImports = parsePythonScript("a = x * 2");
	assert.ok(noImports);
	assert.deepEqual(noImports.imports, []);
	assert.equal(noImports.body, "a = x * 2");

	const trailingNewline = parsePythonScript("import x\n\na = x * 2\n");
	assert.equal(trailingNewline.body, "a = x * 2\n");
	assert.equal(trailingNewline.lineMap.body.lineCount, 1);
	assert.equal(trailingNewline.lineMap.imports.lineCount, 1);
});
