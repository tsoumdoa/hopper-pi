import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { serializeAgentEvent, toWireValue } from "./event-serializer.js";

describe("agent event serialization", () => {
	it("removes cumulative partial messages from text deltas", () => {
		const result = serializeAgentEvent({
			type: "message_update",
			message: { role: "assistant", usage: { input: 1 }, content: [] },
			assistantMessageEvent: {
				type: "text_delta",
				delta: "hello",
				contentIndex: 0,
				partial: { role: "assistant", content: [{ type: "text", text: "a very long cumulative value" }] },
			},
		} as unknown as AgentSessionEvent) as Record<string, unknown>;

		expect(result).toEqual({
			type: "message_update",
			usage: { input: 1 },
			assistantMessageEvent: { type: "text_delta", delta: "hello", contentIndex: 0 },
		});
	});

	it("keeps tool identity without the cumulative partial", () => {
		const result = serializeAgentEvent({
			type: "message_update",
			message: { role: "assistant", usage: {}, content: [] },
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				partial: { content: [{ type: "toolCall", id: "call-1", name: "gh_apply_graph" }] },
			},
		} as unknown as AgentSessionEvent) as Record<string, any>;

		expect(result.assistantMessageEvent.id).toBe("call-1");
		expect(result.assistantMessageEvent.toolName).toBe("gh_apply_graph");
		expect(result.assistantMessageEvent.partial).toBeUndefined();
	});

	it("normalizes errors and bigint values", () => {
		expect(toWireValue({ count: 4n, error: new Error("broken") })).toEqual({
			count: "4",
			error: { name: "Error", message: "broken" },
		});
	});

	it("replaces cyclic values instead of throwing", () => {
		const value: Record<string, unknown> = { label: "root" };
		value.self = value;

		expect(toWireValue(value)).toEqual({ label: "root", self: "[Circular]" });
	});
});
