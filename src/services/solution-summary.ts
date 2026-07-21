import type { GetCanvasErrorsResponse } from "../types/messages.js";

const MAX_SHOWN = 3;
const MAX_TEXT = 110;

/**
 * Compact one-glance solution status appended to mutation results (e.g. after
 * wiring), so the agent can skip a dedicated gh_get_canvas_errors round-trip
 * in the happy path. Levels "message"/"unknown" are excluded as noise.
 */
export function formatSolutionSummary(response: GetCanvasErrorsResponse): string {
	const errors = response.errors.filter((e) => e.level === "error");
	const warnings = response.errors.filter((e) => e.level === "warning");

	if (errors.length === 0 && warnings.length === 0) {
		return "solution: no errors or warnings";
	}

	const lines: string[] = [
		`solution: ${errors.length} error(s), ${warnings.length} warning(s)`,
	];

	const shown = [...errors, ...warnings].slice(0, MAX_SHOWN);
	for (const e of shown) {
		const flattened = e.text.replace(/\s*\n\s*/g, " ").trim();
		const text = flattened.length > MAX_TEXT ? `${flattened.slice(0, MAX_TEXT)}…` : flattened;
		lines.push(`  ${e.level === "error" ? "❌" : "⚠️"} [${e.componentNickName}] ${text}`);
	}

	const remaining = errors.length + warnings.length - shown.length;
	if (remaining > 0) {
		lines.push(`  … ${remaining} more — call gh_get_canvas_errors for the full list`);
	}

	return lines.join("\n");
}
