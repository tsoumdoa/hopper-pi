import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "./protocol.js";

export function toWireValue(value: unknown): JsonValue {
	const seen = new WeakSet<object>();
	const serialized = JSON.stringify(value, (_key, current: unknown) => {
		if (typeof current === "bigint") return current.toString();
		if (current instanceof Error) return { name: current.name, message: current.message };
		if (typeof current === "function" || typeof current === "undefined") return undefined;
		if (current !== null && typeof current === "object") {
			if (seen.has(current)) return "[Circular]";
			seen.add(current);
		}
		return current;
	});
	return serialized === undefined ? null : JSON.parse(serialized) as JsonValue;
}

export function serializeAgentEvent(event: AgentSessionEvent): JsonValue {
	if (event.type !== "message_update") return toWireValue(event);

	const update = event.assistantMessageEvent as Record<string, unknown>;
	const { partial: _partial, ...withoutPartial } = update;
	if (update.type === "toolcall_start" && update.partial && typeof update.contentIndex === "number") {
		const partial = update.partial as { content?: unknown[] };
		const item = partial.content?.[update.contentIndex] as { type?: string; id?: string; name?: string } | undefined;
		if (item?.type === "toolCall") {
			withoutPartial.id = item.id;
			withoutPartial.toolName = item.name;
		}
	}

	const message = event.message as { usage?: unknown };
	return toWireValue({
		type: "message_update",
		usage: message.usage,
		assistantMessageEvent: withoutPartial,
	});
}
