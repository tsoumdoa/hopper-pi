import type { LinePatch, ParsedPythonScript, PythonPatchScope } from "../types/python-script.js";
import { assemblePythonScript, parsePythonScript } from "./python-script-assembler.js";
import { applyLinePatches } from "./csharp-script-patcher.js";

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
	if (scope === "full") {
		return applyLinePatches(code, patches);
	}

	const parsed = parsePythonScript(code);

	let nextParts: ParsedPythonScript;
	switch (scope) {
		case "imports":
			nextParts = patchImports(parsed, patches);
			break;
		case "body":
			nextParts = patchBody(parsed, patches);
			break;
		default:
			throw new Error(`Unknown patch scope "${scope as string}".`);
	}

	return assemblePythonScript(nextParts);
}
