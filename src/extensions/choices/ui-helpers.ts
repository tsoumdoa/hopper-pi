import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export function noUiResult(
	message: string,
	details: Record<string, unknown> = {},
): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text" as const, text: message }],
		details,
	};
}
