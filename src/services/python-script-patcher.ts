import type { LinePatch, ParsedPythonScript, PythonPatchScope } from "../types/python-script.js";
import { applyScopedPatches } from "../lib/scoped-patcher.js";
import { applyLinePatches } from "./csharp-script-patcher.js";
import { assemblePythonScript, parsePythonScript } from "./python-script-assembler.js";

// lineMap is not recomputed here; only assemblePythonScript output is used.
function patchImports(parts: ParsedPythonScript, patches: LinePatch[]): ParsedPythonScript {
	const current = parts.imports.join("\n");
	const next = applyLinePatches(current, patches);
	return {
		...parts,
		imports: next.length === 0 ? [] : next.split("\n"),
	};
}

function patchBody(parts: ParsedPythonScript, patches: LinePatch[]): ParsedPythonScript {
	return {
		...parts,
		body: applyLinePatches(parts.body, patches),
	};
}

export function applyPatchesToPythonScript(
	code: string,
	patches: LinePatch[],
	scope: PythonPatchScope = "body",
): string {
	return applyScopedPatches(code, patches, scope, {
		parse: parsePythonScript,
		parseError: "Script must be valid Python.",
		assemble: assemblePythonScript,
		patchers: {
			imports: patchImports,
			body: patchBody,
		},
	});
}
