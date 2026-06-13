export type CsharpScriptPartsInput = {
	references?: string[];
	runScript: string;
	helpers?: string;
};

export type CsharpScriptParts = {
	references: string[];
	runScript: string;
	runScriptBody: string;
	helpers: string;
};

export type CsharpScriptLineMap = {
	runScriptBody: { startLine: number; lineCount: number };
	runScript: { startLine: number; lineCount: number };
	helpers: { startLine: number; lineCount: number };
	references: { startLine: number; lineCount: number };
};

export type ParsedCsharpScript = CsharpScriptParts & {
	lineMap: CsharpScriptLineMap;
};

export type LinePatch =
	| { op: "insert"; afterLine: number; lines: string[] }
	| { op: "replace"; startLine: number; endLine: number; lines: string[] }
	| { op: "delete"; startLine: number; endLine: number };

export type PatchScope = "runScriptBody" | "runScript" | "helpers" | "references" | "full";
