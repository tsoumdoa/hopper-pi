import type { ParsedPythonScript } from "../types/python-script.js";

const IMPORT_PATTERN = /^\s*(import\s+|from\s+[\w.]+\s+import\s+)/;

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length;
}

function isImportLine(line: string): boolean {
	return IMPORT_PATTERN.test(line);
}

function isSkippableLeadingLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.length === 0 || trimmed.startsWith("#");
}

export function parsePythonScript(code: string): ParsedPythonScript | null {
	const normalized = code.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const imports: string[] = [];
	let bodyStart = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (imports.length === 0 && isSkippableLeadingLine(line)) {
			continue;
		}

		if (isImportLine(line)) {
			imports.push(line);
			bodyStart = i + 1;
			continue;
		}

		bodyStart = i;
		break;
	}

	while (bodyStart < lines.length && lines[bodyStart].trim().length === 0) {
		bodyStart++;
	}

	const body = lines.slice(bodyStart).join("\n");

	return {
		imports,
		body,
		lineMap: {
			imports: { startLine: 1, lineCount: countLines(imports.join("\n")) },
			body: { startLine: 1, lineCount: countLines(body) },
		},
	};
}

export function assemblePythonScript(parts: Pick<ParsedPythonScript, "imports" | "body">): string {
	const importBlock = parts.imports.join("\n");
	const body = parts.body.replace(/\r\n/g, "\n");

	if (importBlock.length === 0) return body;
	if (body.length === 0) return importBlock;
	return `${importBlock}\n\n${body}`;
}

export function formatPythonScriptParts(parts: ParsedPythonScript): string {
	return JSON.stringify(
		{
			imports: parts.imports,
			body: parts.body,
			lineMap: parts.lineMap,
		},
		null,
		2,
	);
}
