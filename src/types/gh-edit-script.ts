import type { ScriptIOParam } from "./commands.js";
import type { CsharpScriptPartsInput, LinePatch, PatchScope } from "./csharp-script.js";

export type GhEditScriptItem =
	| {
		action: "create";
		x: number;
		y: number;
		language: "python" | "csharp";
		code?: string;
		scriptParts?: CsharpScriptPartsInput;
		nickName?: string;
		inputs?: ScriptIOParam[];
		outputs?: ScriptIOParam[];
	}
	| {
		action: "setCode";
		targetId: string;
		code?: string;
		scriptParts?: CsharpScriptPartsInput;
		inputs?: ScriptIOParam[];
		outputs?: ScriptIOParam[];
	}
	| {
		action: "patchCode";
		targetId: string;
		patches: LinePatch[];
		scope?: PatchScope;
		inputs?: ScriptIOParam[];
		outputs?: ScriptIOParam[];
	}
	| { action: "getCode"; targetId: string }
	| { action: "getCodeParts"; targetId: string };

export type ResolvedGhEditScriptItem = Exclude<GhEditScriptItem, { action: "getCode" | "getCodeParts" }> & {
	resolvedCode?: string;
};
