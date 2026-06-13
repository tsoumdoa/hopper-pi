import type { LinePatch } from "./csharp-script.js";

export type { LinePatch };

export type PythonScriptParts = {
	imports: string[];
	body: string;
};

export type PythonScriptLineMap = {
	imports: { startLine: number; lineCount: number };
	body: { startLine: number; lineCount: number };
};

export type ParsedPythonScript = PythonScriptParts & {
	lineMap: PythonScriptLineMap;
};

export type PythonPatchScope = "body" | "imports" | "full";
