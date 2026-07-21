import { parseCsharpScript } from "./csharp-script-assembler.js";
import type { CanvasError } from "../types/messages.js";

/**
 * Maps C# compile diagnostics reported in full-file coordinates (e.g.
 * "'Point' is an ambiguous reference ... [117:16]") to patchCode-ready
 * scope-relative coordinates plus the offending source line, so the agent can
 * patch blind instead of re-reading the whole script with getCodeParts.
 */

export type CompileErrorLocation = {
	scope: "runScriptBody" | "runScript" | "helpers" | "full";
	line: number;
	text: string;
};

const LINE_COL_PATTERN = /\[(\d+):(\d+)\]/;
const MAX_CODE_FETCHES = 3;
const MAX_SNIPPET = 120;

export function extractCompileLine(errorText: string): number | null {
	const m = LINE_COL_PATTERN.exec(errorText);
	if (!m) return null;
	const line = Number.parseInt(m[1], 10);
	return Number.isFinite(line) && line > 0 ? line : null;
}

/** Index of the unique line in `block` whose trimmed text equals `trimmed`, or null. */
function uniqueLineIndex(block: string, trimmed: string): number | null {
	if (!trimmed) return null;
	const lines = block.split("\n");
	let found: number | null = null;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === trimmed) {
			if (found != null) return null; // ambiguous — refuse to guess
			found = i;
		}
	}
	return found;
}

export function locateCompileError(code: string, fullLine: number): CompileErrorLocation | null {
	const lines = code.replace(/\r\n/g, "\n").split("\n");
	if (fullLine < 1 || fullLine > lines.length) return null;
	const text = lines[fullLine - 1].trim();
	const fallback: CompileErrorLocation = { scope: "full", line: fullLine, text };

	// Python scripts or unexpected shapes fall back to full-file coordinates,
	// which is exactly the "full" patch scope for Python.
	const parsed = parseCsharpScript(code);
	if (!parsed) return fallback;

	const rs = parsed.lineMap.runScript;
	if (fullLine >= rs.startLine && fullLine < rs.startLine + rs.lineCount) {
		// Prefer runScriptBody (the default patch scope) when the line maps uniquely.
		const bodyIdx = uniqueLineIndex(parsed.runScriptBody, text);
		if (bodyIdx != null) return { scope: "runScriptBody", line: bodyIdx + 1, text };
		return { scope: "runScript", line: fullLine - rs.startLine + 1, text };
	}

	const helperIdx = uniqueLineIndex(parsed.helpers, text);
	if (helperIdx != null) return { scope: "helpers", line: helperIdx + 1, text };

	return fallback;
}

export function formatPatchHint(loc: CompileErrorLocation): string {
	const target = loc.scope === "full"
		? `scope=full line=${loc.line}`
		: `scope=${loc.scope} line=${loc.line}`;
	const snippet = loc.text.length > MAX_SNIPPET ? `${loc.text.slice(0, MAX_SNIPPET)}…` : loc.text;
	return `patch hint: ${target} → \`${snippet}\` (gh_edit_script patchCode; no code re-read needed)`;
}

/**
 * Builds patch hints for compile errors, keyed by index into `errors`.
 * Script code is fetched lazily (at most MAX_CODE_FETCHES distinct
 * components); fetch failures (e.g. non-script components) are skipped.
 */
export async function buildCompileErrorHints(
	errors: CanvasError[],
	fetchCode: (componentId: string) => Promise<string>,
): Promise<Map<number, string>> {
	const hints = new Map<number, string>();
	const codeCache = new Map<string, string | null>();
	let fetches = 0;

	for (let i = 0; i < errors.length; i++) {
		const err = errors[i];
		if (err.level !== "error") continue;
		const line = extractCompileLine(err.text);
		if (line == null) continue;

		let code = codeCache.get(err.componentId);
		if (code === undefined) {
			if (fetches >= MAX_CODE_FETCHES) continue;
			fetches++;
			try {
				code = await fetchCode(err.componentId);
			} catch {
				code = null;
			}
			codeCache.set(err.componentId, code);
		}
		if (!code) continue;

		const loc = locateCompileError(code, line);
		if (!loc) continue;
		hints.set(i, formatPatchHint(loc));
	}

	return hints;
}
