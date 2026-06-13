import type {
	CsharpScriptPartsInput,
	ParsedCsharpScript,
} from "../types/csharp-script.js";

export const DEFAULT_CSHARP_REFERENCES = [
	"System",
	"System.Collections",
	"System.Collections.Generic",
	"System.Linq",
	"Rhino",
	"Rhino.Geometry",
	"Grasshopper",
	"Grasshopper.Kernel",
	"Grasshopper.Kernel.Data",
	"Grasshopper.Kernel.Types",
];

const SCRIPT_CLASS_PATTERN =
	/public\s+class\s+Script_Instance\s*:\s*GH_ScriptInstance\b/;
const RUN_SCRIPT_PATTERN = /\bprivate\s+void\s+RunScript\s*\(/;
const USING_PATTERN = /^\s*using\s+([\w.]+)\s*;\s*$/;

export function findMatchingBrace(code: string, openIndex: number): number {
	let depth = 0;
	let inString: "'" | '"' | null = null;
	let escape = false;

	for (let i = openIndex; i < code.length; i++) {
		const ch = code[i];

		if (inString) {
			if (escape) {
				escape = false;
				continue;
			}
			if (ch === "\\") {
				escape = true;
				continue;
			}
			if (ch === inString) inString = null;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = ch;
			continue;
		}

		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}

	return -1;
}

export function extractRunScript(code: string): {
	signature: string;
	body: string;
	methodStart: number;
	methodEnd: number;
	bodyStart: number;
	bodyEnd: number;
} | null {
	const match = RUN_SCRIPT_PATTERN.exec(code);
	if (!match) return null;

	const openParen = code.indexOf("(", match.index);
	if (openParen < 0) return null;

	let depth = 0;
	let inString: "'" | '"' | null = null;
	let escape = false;
	let closeParen = -1;

	for (let i = openParen; i < code.length; i++) {
		const ch = code[i];

		if (inString) {
			if (escape) {
				escape = false;
				continue;
			}
			if (ch === "\\") {
				escape = true;
				continue;
			}
			if (ch === inString) inString = null;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = ch;
			continue;
		}

		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) {
				closeParen = i;
				break;
			}
		}
	}

	if (closeParen < 0) return null;

	const bodyOpen = code.indexOf("{", closeParen);
	if (bodyOpen < 0) return null;

	const bodyClose = findMatchingBrace(code, bodyOpen);
	if (bodyClose < 0) return null;

	return {
		signature: code.slice(openParen + 1, closeParen),
		body: code.slice(bodyOpen + 1, bodyClose),
		methodStart: match.index,
		methodEnd: bodyClose + 1,
		bodyStart: bodyOpen + 1,
		bodyEnd: bodyClose,
	};
}

function normalizeReference(reference: string): string {
	return reference.trim().replace(/^using\s+/i, "").replace(/;$/, "").trim();
}

function normalizeReferences(references?: string[]): string[] {
	const source = references && references.length > 0 ? references : DEFAULT_CSHARP_REFERENCES;
	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const reference of source) {
		const value = normalizeReference(reference);
		if (!value || seen.has(value)) continue;
		seen.add(value);
		normalized.push(value);
	}

	return normalized;
}

function indentBlock(text: string, spaces: number): string {
	const indent = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `${indent}${line}` : ""))
		.join("\n");
}

function dedentBlock(text: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^\s*/)?.[0].length ?? 0);
	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

	return lines
		.map((line) => (line.length >= minIndent ? line.slice(minIndent) : line))
		.join("\n")
		.trimEnd();
}

function extractClassBody(code: string): { body: string; bodyStart: number; bodyEnd: number } | null {
	const classMatch = SCRIPT_CLASS_PATTERN.exec(code);
	if (!classMatch) return null;

	const openBrace = code.indexOf("{", classMatch.index);
	if (openBrace < 0) return null;

	const closeBrace = findMatchingBrace(code, openBrace);
	if (closeBrace < 0) return null;

	return {
		body: code.slice(openBrace + 1, closeBrace),
		bodyStart: openBrace + 1,
		bodyEnd: closeBrace,
	};
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length;
}

function lineNumberAt(code: string, index: number): number {
	return code.slice(0, index).split("\n").length;
}

export function parseCsharpScript(code: string): ParsedCsharpScript | null {
	const normalized = code.replace(/\r\n/g, "\n");
	const references: string[] = [];
	let cursor = 0;

	while (cursor < normalized.length) {
		const lineEnd = normalized.indexOf("\n", cursor);
		const line = lineEnd >= 0
			? normalized.slice(cursor, lineEnd)
			: normalized.slice(cursor);
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			cursor = lineEnd >= 0 ? lineEnd + 1 : normalized.length;
			continue;
		}

		const usingMatch = USING_PATTERN.exec(line);
		if (usingMatch) {
			references.push(usingMatch[1]);
			cursor = lineEnd >= 0 ? lineEnd + 1 : normalized.length;
			continue;
		}

		break;
	}

	const classBody = extractClassBody(normalized);
	if (!classBody) return null;

	const runScript = extractRunScript(classBody.body);
	if (!runScript) return null;

	const helpers = dedentBlock(
		`${classBody.body.slice(0, runScript.methodStart)}${classBody.body.slice(runScript.methodEnd)}`.trim(),
	);

	const runScriptMethod = dedentBlock(classBody.body.slice(runScript.methodStart, runScript.methodEnd));
	const runScriptBody = dedentBlock(runScript.body.replace(/\r\n/g, "\n"));
	const runScriptStartLine = lineNumberAt(normalized, classBody.bodyStart + runScript.methodStart);

	return {
		references: references.length > 0 ? references : [...DEFAULT_CSHARP_REFERENCES],
		runScript: runScriptMethod,
		runScriptBody,
		helpers,
		lineMap: {
			references: { startLine: 1, lineCount: references.length },
			runScript: { startLine: runScriptStartLine, lineCount: countLines(runScriptMethod) },
			runScriptBody: { startLine: 1, lineCount: countLines(runScriptBody) },
			helpers: {
				startLine: 1,
				lineCount: countLines(helpers),
			},
		},
	};
}

export function assembleCsharpScript(parts: CsharpScriptPartsInput): string {
	const references = normalizeReferences(parts.references);
	const runScript = dedentBlock(parts.runScript.trim());
	const helpers = parts.helpers ? dedentBlock(parts.helpers.trim()) : "";

	const usingLines = references.map((reference) => `using ${reference};`);
	const classLines = [
		"public class Script_Instance : GH_ScriptInstance",
		"{",
		indentBlock(runScript, 2),
	];

	if (helpers.length > 0) {
		classLines.push("");
		classLines.push(indentBlock(helpers, 2));
	}

	classLines.push("}");

	return [...usingLines, "", ...classLines].join("\n");
}

export function replaceRunScriptBody(runScript: string, body: string): string {
	const extracted = extractRunScript(runScript);
	if (!extracted) {
		throw new Error("runScript must contain a private void RunScript(...) method.");
	}

	const methodPrefix = runScript.slice(0, extracted.bodyStart);
	const methodSuffix = runScript.slice(extracted.bodyEnd);
	const normalizedBody = body.replace(/\r\n/g, "\n");
	const bodyLines = normalizedBody.split("\n");
	const indentedBody = bodyLines.length === 1 && bodyLines[0].length === 0
		? ""
		: bodyLines.map((line) => (line.length > 0 ? `  ${line}` : "")).join("\n");

	return `${methodPrefix}${indentedBody}${methodSuffix}`;
}

export function getRunScriptBody(runScript: string): string {
	const extracted = extractRunScript(runScript);
	if (!extracted) return "";
	return dedentBlock(extracted.body);
}

export function formatCsharpScriptParts(parts: ParsedCsharpScript): string {
	return JSON.stringify(
		{
			references: parts.references,
			runScript: parts.runScript,
			runScriptBody: parts.runScriptBody,
			helpers: parts.helpers || undefined,
			lineMap: parts.lineMap,
		},
		null,
		2,
	);
}
