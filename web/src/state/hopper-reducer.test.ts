import { describe, expect, it } from "vitest";
import { hopperReducer, initialHopperState } from "./hopper-reducer";

describe("hopperReducer", () => {
	it("hydrates a session snapshot without inventing a browser-side session", () => {
		const state = hopperReducer(initialHopperState, {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				sessionName: "Facade study",
				isStreaming: false,
				thinkingLevel: "high",
				availableThinkingLevels: ["off", "high"],
				model: { provider: "openai", id: "gpt-5" },
				models: [{ provider: "openai", id: "gpt-5" }],
				providers: [{ id: "openai", name: "OpenAI", authenticated: true }],
				messages: [{ id: "user-1", role: "user", content: "Inspect this canvas" }],
			},
		});
		expect(state.connection.status).toBe("connected");
		expect(state.session).toMatchObject({ id: "session-1", name: "Facade study", isStreaming: false });
		expect(state.session.messages).toMatchObject([{ role: "user", text: "Inspect this canvas" }]);
		expect(state.selectedModel).toEqual({ provider: "openai", id: "gpt-5" });
	});

	it("keeps streamed text and tool status on the active assistant message", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking " } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: { query: "slider" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "tool_execution_end", toolCallId: "tool-1", result: "Found 3", isError: false } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "agent_end" } });
		expect(state.session.messages).toMatchObject([{ id: "assistant-1", text: "Checking ", streaming: false, tools: [{ id: "tool-1", status: "complete", detail: "Found 3" }] }]);
	});

	it("shows one agent input dialog at a time", () => {
		const first = { requestId: "first", kind: "input" as const, title: "Name it" };
		const second = { requestId: "second", kind: "confirm" as const, title: "Continue?" };
		let state = hopperReducer(initialHopperState, { type: "ui-request", request: first });
		state = hopperReducer(state, { type: "ui-request", request: second });
		expect(state.activeUiRequest?.requestId).toBe("first");
		expect(state.pendingUiRequests).toHaveLength(1);
		state = hopperReducer(state, { type: "ui-request-resolved" });
		expect(state.activeUiRequest?.requestId).toBe("second");
	});
});
