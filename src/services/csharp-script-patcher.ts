import type { LinePatch, ParsedCsharpScript, PatchScope } from "../types/csharp-script.js";
import {
	assembleCsharpScript,
	getRunScriptBody,
	parseCsharpScript,
	replaceRunScriptBody,
} from "./csharp-script-assembler.js";

function splitLines(text: string): string[] {
	return text.replace(/\r\n/g, "\n").split("\n");
}

function joinLines(lines: string[]): string {
	return lines.join("\n");
}

export function applyLinePatches(text: string, patches: LinePatch[]): string {
	let lines = splitLines(text);

	for (const patch of patches) {
		switch (patch.op) {
			case "insert": {
				if (patch.afterLine < 0 || patch.afterLine > lines.length) {
					throw new Error(
						`insert afterLine ${patch.afterLine} is out of range (0-${lines.length}).`,
					);
				}
				lines.splice(patch.afterLine, 0, ...patch.lines);
				break;
			}
			case "replace": {
				validateLineRange(lines.length, patch.startLine, patch.endLine, "replace");
				lines.splice(patch.startLine - 1, patch.endLine - patch.startLine + 1, ...patch.lines);
				break;
			}
			case "delete": {
				validateLineRange(lines.length, patch.startLine, patch.endLine, "delete");
				lines.splice(patch.startLine - 1, patch.endLine - patch.startLine + 1);
				break;
			}
		}
	}

	return joinLines(lines);
}

function validateLineRange(
	lineCount: number,
	startLine: number,
	endLine: number,
	op: string,
): void {
	if (startLine < 1 || endLine < startLine || endLine > lineCount) {
		throw new Error(
			`${op} range ${startLine}-${endLine} is out of range (1-${lineCount}).`,
		);
	}
}

function patchReferences(parts: ParsedCsharpScript, patches: LinePatch[]): ParsedCsharpScript {
	const current = joinLines(parts.references);
	const next = applyLinePatches(current, patches);
	return {
		...parts,
		references: next.split("\n").filter((line) => line.trim().length > 0),
	};
}

function patchRunScript(parts: ParsedCsharpScript, patches: LinePatch[]): ParsedCsharpScript {
	const nextRunScript = applyLinePatches(parts.runScript, patches);
	return {
		...parts,
		runScript: nextRunScript,
		runScriptBody: getRunScriptBody(nextRunScript),
	};
}

function patchRunScriptBody(parts: ParsedCsharpScript, patches: LinePatch[]): ParsedCsharpScript {
	const nextBody = applyLinePatches(parts.runScriptBody, patches);
	return {
		...parts,
		runScriptBody: nextBody,
		runScript: replaceRunScriptBody(parts.runScript, nextBody),
	};
}

function patchHelpers(parts: ParsedCsharpScript, patches: LinePatch[]): ParsedCsharpScript {
	return {
		...parts,
		helpers: applyLinePatches(parts.helpers, patches),
	};
}

export function applyPatchesToScript(
	code: string,
	patches: LinePatch[],
	scope: PatchScope = "runScriptBody",
): string {
	if (scope === "full") {
		return applyLinePatches(code, patches);
	}

	const parsed = parseCsharpScript(code);
	if (!parsed) {
		throw new Error("Script must be a Grasshopper C# script with Script_Instance and RunScript.");
	}

	let nextParts: ParsedCsharpScript;
	switch (scope) {
		case "references":
			nextParts = patchReferences(parsed, patches);
			break;
		case "runScript":
			nextParts = patchRunScript(parsed, patches);
			break;
		case "runScriptBody":
			nextParts = patchRunScriptBody(parsed, patches);
			break;
		case "helpers":
			nextParts = patchHelpers(parsed, patches);
			break;
		default:
			throw new Error(`Unknown patch scope "${scope as string}".`);
	}

	return assembleCsharpScript(nextParts);
}
