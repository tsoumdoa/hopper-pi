import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/** Persist a question and release the task before the browser answers. */
export type SuspendQuestion = (toolCallId: string, payload: unknown) => Promise<AgentToolResult<unknown>>;

export function throwNoUi(toolName: "ask_user" | "pick_option"): never {
	throw new Error(
		`${toolName} requires an interactive UI, which is not available in this session. Proceed without asking the user; use reasonable defaults or state assumptions in your reply.`,
	);
}
