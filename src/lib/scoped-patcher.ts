import type { LinePatch } from "../types/csharp-script.js";
import { applyLinePatches } from "../services/csharp-script-patcher.js";

export function applyScopedPatches<TParts>(
	code: string,
	patches: LinePatch[],
	scope: string,
	options: {
		fullScope?: string;
		parse: (code: string) => TParts | null;
		parseError: string;
		patchers: Record<string, (parts: TParts, patches: LinePatch[]) => TParts>;
		assemble: (parts: TParts) => string;
	},
): string {
	if (scope === (options.fullScope ?? "full")) {
		return applyLinePatches(code, patches);
	}

	const parsed = options.parse(code);
	if (!parsed) {
		throw new Error(options.parseError);
	}

	const patcher = options.patchers[scope];
	if (!patcher) {
		throw new Error(`Unknown patch scope "${scope}".`);
	}

	return options.assemble(patcher(parsed, patches));
}
