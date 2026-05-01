import type { AgentSession } from "@mariozechner/pi-coding-agent";

export async function runOnce(
	session: AgentSession,
	promptText: string
): Promise<void> {
	const result = await session.prompt(promptText);
	return result;
}