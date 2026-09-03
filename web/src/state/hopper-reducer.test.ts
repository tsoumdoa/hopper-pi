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
		expect(state.session.messages).toMatchObject([{ id: "assistant-1", text: "Checking ", streaming: false, tools: [{ id: "tool-1", status: "complete", args: { query: "slider" }, detail: "Found 3" }] }]);
		expect(state.session.isStreaming).toBe(false);
	});

	it("shows a provider failure instead of treating it as an empty response", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, {
			type: "agent-event",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: "Request failed",
					diagnostics: [{ type: "provider_transport_failure", error: { message: "WebSocket error" } }],
				},
			},
		});
		expect(state.session.messages).toMatchObject([{ id: "assistant-1", text: "", error: "Request failed: WebSocket error", streaming: false }]);
	});

	it("uses the completed assistant payload when no text deltas arrived", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, {
			type: "agent-event",
			event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Recovered final answer" }], stopReason: "stop" } },
		});
		expect(state.session.messages).toMatchObject([{ id: "assistant-1", text: "Recovered final answer", streaming: false }]);
	});

	it("starts a fresh assistant message instead of appending to a previous turn", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "First answer" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "agent_end" } });
		state = hopperReducer(state, { type: "user-message", text: "Second question", kind: "prompt" });
		expect(state.session.isStreaming).toBe(true);
		state = hopperReducer(state, { type: "agent-event", event: { type: "tool_execution_start", toolCallId: "tool-2", toolName: "gh_apply_graph", args: {} } });
		expect(state.session.messages.map((message) => message.role)).toEqual(["assistant", "user", "assistant"]);
		expect(state.session.messages[0]?.tools).toHaveLength(0);
		expect(state.session.messages[2]?.tools).toMatchObject([{ id: "tool-2", status: "running" }]);
	});

	it("keeps tool arguments when the execution event repeats a tool already announced in the stream", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "message_update", assistantMessageEvent: { type: "toolcall_start", id: "tool-1", toolName: "gh_list_components" } } });
		state = hopperReducer(state, { type: "agent-event", event: { type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: { search: "panel" } } });
		expect(state.session.messages[0]?.tools).toMatchObject([{ id: "tool-1", args: { search: "panel" }, status: "running" }]);
	});

	it("tracks the provider sign-in flow and clears it on completion", () => {
		let state = hopperReducer(initialHopperState, { type: "auth-start", provider: "openai", notice: "Checking the API key…" });
		expect(state.auth).toMatchObject({ busy: true, provider: "openai", notice: "Checking the API key…", error: null });
		state = hopperReducer(state, { type: "auth-error", error: "Invalid key" });
		expect(state.auth).toMatchObject({ busy: false, error: "Invalid key", notice: null });
		state = hopperReducer(state, { type: "auth-start", provider: "openai", notice: "Checking the API key…" });
		state = hopperReducer(state, { type: "auth-complete" });
		expect(state.auth).toMatchObject({ busy: false, error: null, completedCount: 1 });
	});

	it("settles streaming state when the connection drops", () => {
		let state = hopperReducer(initialHopperState, { type: "agent-event", event: { type: "message_start", message: { id: "assistant-1", role: "assistant" } } });
		state = hopperReducer(state, { type: "connection", status: "disconnected", detail: "Closed" });
		expect(state.session.isStreaming).toBe(false);
		expect(state.session.messages[0]?.streaming).toBe(false);
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
