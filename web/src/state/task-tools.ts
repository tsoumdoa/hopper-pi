import type { ToolCall } from "./hopper-types";
import type { EventSnapshot } from "../../../src/protocol/browser-snapshot.js";
import { readProgress, type BrowserMessage } from "../../../src/protocol/browser-payloads.js";

/** Rebuild the PR #47 tool cards from both live journal events and saved Pi messages. */
export function taskTools(events: EventSnapshot[]): ToolCall[] {
	const tools = new Map<string, ToolCall>();
	for (const row of events) {
		const payload = readProgress(row.payload);
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
		const start = (id: unknown, name: unknown, args: unknown, status?: ToolCall["status"]) => {
			const toolId = key(id);
			const prior = tools.get(toolId);
			tools.set(toolId, {
				id: toolId, name: String(name ?? prior?.name ?? "Tool call"),
				args: args ?? prior?.args,
				detail: prior && prior.detail !== prior.args ? prior.detail : args ?? prior?.args,
				status: status ?? prior?.status ?? "complete",
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
		const message = (item: BrowserMessage | undefined, running = false) => {
			if (item?.role === "assistant" && Array.isArray(item.content)) {
				for (const part of item.content) if (part.type === "toolCall")
					start(part.id ?? part.toolCallId, part.name, part.arguments, running ? "running" : undefined);
			}
			if (item?.role === "toolResult") {
				// Preserve textual content even when the tool also returns empty or internal details.
				result(item.toolCallId, item.toolName, { content: item.content, details: item.details }, Boolean(item.isError));
			}
		};
		if (payload.type === "assistant_message") message(payload.message, Boolean(payload.streaming));
		if (payload.type === "messages") for (const item of payload.messages ?? []) message(item);
		const event = payload.event;
		if (payload.type === "agent_event" && event) {
			if (event.type === "message_start" || event.type === "message_end") message(event.message);
			const update = event.assistantMessageEvent;
			if (update?.type === "toolcall_start" && update.id) {
				const toolId = key(update.id);
				if (!tools.has(toolId)) tools.set(toolId, {
					id: toolId, name: String(update.toolName ?? "Tool call"), detail: undefined, status: "generating",
				});
			}
			if (update?.type === "toolcall_end" && update.toolCall)
				start(update.toolCall.id, update.toolCall.name, update.toolCall.arguments, tools.get(key(update.toolCall.id))?.status === "generating" ? undefined : "running");
		}
		if (payload.type === "tool_progress") {
			if (payload.phase === "generating" || payload.phase === "started") {
				start(payload.toolCallId, payload.toolName, event?.args ?? payload.args, payload.phase === "generating" ? "generating" : "running");
			} else {
				result(payload.toolCallId, payload.toolName,
					payload.phase === "updated" ? event?.partialResult ?? payload.partialResult : event?.result ?? payload.result,
					Boolean(event?.isError ?? payload.isError), payload.phase === "updated");
			}
		}
	}
	return [...tools.values()];
}
