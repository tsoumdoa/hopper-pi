export type CsharpScriptValidationOptions = {
	inputNames?: string[];
	outputNames?: string[];
};

export type CsharpScriptValidationResult = {
	valid: boolean;
	errors: string[];
};

type RunScriptParam = {
	name: string;
	typeName: string;
};

type RunScriptParams = {
	inputs: RunScriptParam[];
	outputs: RunScriptParam[];
};

const TYPE_PATTERN = "[\\w<>,\\[\\].\\s?]+";

const SCRIPT_CLASS_PATTERN =
	/public\s+class\s+Script_Instance\s*:\s*GH_ScriptInstance\b/;
const RUN_SCRIPT_PATTERN = /\bprivate\s+void\s+RunScript\s*\(/;

function stripComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n\r]*/g, "");
}

function findMatchingBrace(code: string, openIndex: number): number {
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

function extractRunScript(code: string): { signature: string; body: string } | null {
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
	};
}

function parseRunScriptParams(signature: string): RunScriptParams | null {
	const parts = signature
		.split(",")
		.map((p) => p.replace(/\/\/.*$/, "").trim())
		.filter(Boolean);

	const inputs: RunScriptParam[] = [];
	const outputs: RunScriptParam[] = [];

	const outputPattern = new RegExp(`^ref\\s+(${TYPE_PATTERN})\\s+(\\w+)\\s*$`, "i");
	const inputPattern = new RegExp(`^(${TYPE_PATTERN})\\s+(\\w+)\\s*$`, "i");

	for (const part of parts) {
		const outputMatch = outputPattern.exec(part);
		if (outputMatch) {
			outputs.push({ typeName: outputMatch[1].trim(), name: outputMatch[2] });
			continue;
		}

		const inputMatch = inputPattern.exec(part);
		if (inputMatch) {
			inputs.push({ typeName: inputMatch[1].trim(), name: inputMatch[2] });
			continue;
		}

		return null;
	}

	return { inputs, outputs };
}

function namesMatch(
	expected: string[] | undefined,
	actual: RunScriptParam[],
	label: string,
	errors: string[],
): void {
	if (!expected || expected.length === 0) return;

	const actualNames = actual.map((p) => p.name);

	if (actualNames.length !== expected.length) {
		errors.push(
			`RunScript has ${actualNames.length} ${label} parameter(s) (${actualNames.join(", ") || "none"}), but ${expected.length} were expected (${expected.join(", ")}).`,
		);
		return;
	}

	const missing = expected.filter((name) => !actualNames.includes(name));
	const extra = actualNames.filter((name) => !expected.includes(name));

	if (missing.length > 0 || extra.length > 0) {
		errors.push(
			`RunScript ${label} names must match declared ${label}s. Expected [${expected.join(", ")}], found [${actualNames.join(", ")}].`,
		);
	}
}

function isObjectType(typeName: string): boolean {
	return /^object(\?)?$/i.test(typeName.trim());
}

function hasTypedInputCast(body: string, paramName: string): boolean {
	const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	const castPatterns = [
		new RegExp(`\\(\\s*([\\w<>,\\[\\].\\s?]+)\\s*\\)\\s*${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s+as\\s+([\\w<>,\\[\\].\\s?]+)`),
		new RegExp(`\\b([\\w<>,\\[\\].\\s?]+)\\s+\\w+\\s*=\\s*[^;\\n]*\\b${escaped}\\b`),
		new RegExp(`\\bvar\\s+\\w+\\s*=\\s*\\(\\s*([\\w<>,\\[\\].\\s?]+)\\s*\\)\\s*${escaped}\\b`),
	];

	for (const pattern of castPatterns) {
		const match = pattern.exec(body);
		if (!match) continue;

		const typeName = match[1];
		if (typeName && !isObjectType(typeName)) return true;
	}

	return false;
}

function hasOutputAssignment(body: string, paramName: string): boolean {
	const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}\\s*=`).test(body);
}

export function looksLikeGrasshopperCsharpScript(code: string): boolean {
	return SCRIPT_CLASS_PATTERN.test(code) || /\bGH_ScriptInstance\b/.test(code);
}

export function validateCsharpScript(
	code: string,
	options: CsharpScriptValidationOptions = {},
): CsharpScriptValidationResult {
	const errors: string[] = [];
	const normalized = stripComments(code);

	if (!SCRIPT_CLASS_PATTERN.test(normalized)) {
		errors.push(
			'Code must declare "public class Script_Instance : GH_ScriptInstance".',
		);
	}

	const runScript = extractRunScript(normalized);
	if (!runScript) {
		errors.push(
			'Code must declare "private void RunScript(...)" with a method body.',
		);
		return { valid: false, errors };
	}

	const params = parseRunScriptParams(runScript.signature);
	if (!params) {
		errors.push(
			"RunScript parameters must be one typed input per port (e.g. `double x` or `object x`) and one `ref` output per port (e.g. `ref double a` or `ref object a`).",
		);
		return { valid: false, errors };
	}

	namesMatch(options.inputNames, params.inputs, "input", errors);
	namesMatch(options.outputNames, params.outputs, "output", errors);

	for (const input of params.inputs) {
		if (isObjectType(input.typeName) && !hasTypedInputCast(runScript.body, input.name)) {
			errors.push(
				`RunScript body must cast object input "${input.name}" to a concrete type (e.g. "double value = (double)${input.name};").`,
			);
		}
	}

	for (const output of params.outputs) {
		if (!hasOutputAssignment(runScript.body, output.name)) {
			errors.push(
				`RunScript body must assign to output "${output.name}" (e.g. "${output.name} = result;").`,
			);
		}
	}

	return { valid: errors.length === 0, errors };
}

export function formatCsharpValidationErrors(errors: string[]): string {
	return [
		"C# script validation failed. Grasshopper C# scripts must follow this shape:",
		"",
		"public class Script_Instance : GH_ScriptInstance",
		"{",
		"  private void RunScript(",
		"    double x,       // one param per input (typed or object)",
		"    ref double a    // one ref param per output (typed or ref object)",
		"  )",
		"  {",
		"    // If an input is object, cast it in the body",
		"    // Assign each output",
		"  }",
		"}",
		"",
		"Issues:",
		...errors.map((e) => `- ${e}`),
	].join("\n");
}
