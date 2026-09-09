import type { ToolCall } from "./hopper-types";
import { decode, type Row } from "./shared-snapshot";

/** Rebuild the PR #47 tool cards from both live journal events and saved Pi messages. */
export function taskTools(events: Row[]): ToolCall[] {
	const tools = new Map<string, ToolCall>();
	for (const row of events) {
		const payload = decode<any>(row.payload, {});
		const turnId = String(payload.turnId ?? "");
		const key = (id: unknown) => {
			const raw = String(id ?? "tool");
			// Older progress records omitted turnId. Join them to a known call when possible.
			if (!turnId) return [...tools.keys()].reverse().find((id) => id.endsWith(`:${raw}`)) ?? `:${raw}`;
			if (tools.has(`:${raw}`)) {
				const previous = tools.get(`:${raw}`)!;
				tools.delete(`:${raw}`);
				tools.set(`${turnId}:${raw}`, { ...previous, id: `${turnId}:${raw}` });
			}
			return `${turnId}:${raw}`;
		};
		const start = (id: unknown, name: unknown, args: unknown, running: boolean) => {
			const toolId = key(id);
			const prior = tools.get(toolId);
			tools.set(toolId, {
				id: toolId, name: String(name ?? prior?.name ?? "Tool call"),
				args: args ?? prior?.args,
				detail: prior && prior.detail !== prior.args ? prior.detail : args ?? prior?.args,
				status: running ? "running" : prior?.status ?? "complete",
			});
		};
		const result = (id: unknown, name: unknown, output: unknown, isError: boolean, partial = false) => {
			const toolId = key(id);
			const prior = tools.get(toolId);
			tools.set(toolId, {
				id: toolId, name: String(name ?? prior?.name ?? "Tool call"), args: prior?.args,
				detail: output ?? prior?.detail ?? prior?.args,
				status: partial ? "running" : isError ? "error" : "complete",
			});
		};
		const message = (item: any) => {
			if (item?.role === "assistant" && Array.isArray(item.content)) {
				for (const part of item.content) if (part.type === "toolCall")
					start(part.id ?? part.toolCallId, part.name, part.arguments, false);
			}
			if (item?.role === "toolResult") {
				// Preserve textual content even when the tool also returns empty or internal details.
				result(item.toolCallId, item.toolName, { content: item.content, details: item.details }, Boolean(item.isError));
			}
		};
		if (payload.type === "messages") for (const item of payload.messages ?? []) message(item);
		const event = payload.event;
		if (payload.type === "agent_event" && event) {
			if (event.type === "message_start" || event.type === "message_end") message(event.message);
			const update = event.assistantMessageEvent;
			if (update?.type === "toolcall_end" && update.toolCall)
				start(update.toolCall.id, update.toolCall.name, update.toolCall.arguments, true);
		}
		if (payload.type === "tool_progress") {
			if (payload.phase === "started") {
				start(payload.toolCallId, payload.toolName, event?.args ?? payload.args, true);
			} else {
				result(payload.toolCallId, payload.toolName,
					payload.phase === "updated" ? event?.partialResult ?? payload.partialResult : event?.result ?? payload.result,
					Boolean(event?.isError ?? payload.isError), payload.phase === "updated");
			}
		}
	}
	return [...tools.values()];
}
