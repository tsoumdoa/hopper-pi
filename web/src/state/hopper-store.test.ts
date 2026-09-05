import { describe, expect, it } from "vitest";
import { createHopperStore } from "./hopper-store";
import type { HostSnapshot } from "../../../src/host/protocol.js";

const emptySnapshot: HostSnapshot = {
	sessionId: "session-1", messages: [], isStreaming: false, thinkingLevel: "off",
	availableThinkingLevels: ["off"], models: [], providers: [],
};

describe("Hopper store", () => {
	it.each([false, true])("replaces partial snapshot arguments with execution input, with existing output=%s", (hasOutput) => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applySnapshot({
			...emptySnapshot, isStreaming: true,
			streamingMessage: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "gh_apply_graph", arguments: {} }] },
		});
		const args = { operations: [{ type: "create", name: "Panel" }] };
		const event = actions.applyAgentEvent;
		event({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "tool-1", name: "gh_apply_graph", arguments: args } } });
		if (hasOutput) event({ type: "tool_execution_update", toolCallId: "tool-1", partialResult: "Creating panel" });
		event({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_apply_graph", args });
		expect(store.getState().session.messages[0]?.tools[0]).toMatchObject({ args, detail: hasOutput ? "Creating panel" : args });
		event({ type: "tool_execution_end", toolCallId: "tool-1", result: "Created panel" });
		expect(store.getState().session.messages).toHaveLength(1);
		expect(store.getState().session.messages[0]?.tools).toEqual([{ id: "tool-1", name: "gh_apply_graph", args, detail: "Created panel", status: "complete" }]);
	});

	it("continues a partial reply restored during reconnect or a settings refresh", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applySnapshot({
			...emptySnapshot, isStreaming: true,
			messages: [{ role: "user", content: "Check the canvas" }],
			streamingMessage: { role: "assistant", content: [
				{ type: "text", text: "Checking " },
				{ type: "thinking", thinking: "Inspect the document" },
				{ type: "toolCall", id: "tool-1", name: "gh_list_components", arguments: {} },
			] },
		});
		expect(store.getState().session.messages[1]).toMatchObject({ text: "Checking ", thinking: "Inspect the document", streaming: true });
		actions.applyAgentEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "the canvas." } });
		actions.applyAgentEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Checking the canvas." }] } });
		actions.applyAgentEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: {} });
		actions.applyAgentEvent({ type: "tool_execution_end", toolCallId: "tool-1", result: "Found 12" });
		expect(store.getState().session.messages).toHaveLength(2);
		expect(store.getState().session.messages[1]).toMatchObject({ text: "Checking the canvas.", streaming: false, tools: [{ id: "tool-1", status: "complete", detail: "Found 12" }] });
	});

	it("reuses calls restored just before tool execution begins", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applySnapshot({
			...emptySnapshot, isStreaming: true,
			messages: [{ role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "gh_list_components", arguments: {} }] }],
		});
		expect(store.getState().session.messages[0]?.tools[0]?.status).toBe("running");
		actions.applyAgentEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: {} });
		expect(store.getState().session.messages).toHaveLength(1);
		expect(store.getState().session.messages[0]?.tools).toHaveLength(1);
	});

	it.each(["follow_up", "steer"] as const)("keeps the active reply and tool results when a %s arrives mid-turn", (kind) => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		const event = actions.applyAgentEvent;
		event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking " } });
		event({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", id: "tool-1", toolName: "gh_list_components" } });
		actions.addUserMessage("Then check the sliders", kind);
		event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "the canvas." } });
		event({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Checking the canvas." }] } });
		event({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: { search: "panel" } });
		event({ type: "tool_execution_update", toolCallId: "tool-1", partialResult: "Found 1" });
		expect(store.getState().session.messages[0]?.tools[0]).toMatchObject({ status: "running", detail: "Found 1" });
		event({ type: "tool_execution_end", toolCallId: "tool-1", result: "Found 12", isError: false });
		expect(store.getState().session.messages).toMatchObject([
			{ id: "assistant-1", text: "Checking the canvas.", tools: [{ id: "tool-1", status: "complete", detail: "Found 12", args: { search: "panel" } }] },
			{ role: "user", text: "Then check the sliders", kind },
		]);
		event({ type: "message_start", message: { id: "assistant-2", role: "assistant" } });
		event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking the sliders." } });
		event({ type: "agent_end" });
		expect(store.getState().session.messages.map(({ text }) => text)).toEqual(["Checking the canvas.", "Then check the sliders", "Checking the sliders."]);
		expect(store.getState().session.isStreaming).toBe(false);
	});

	it("matches tool results restored from a reconnect snapshot", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applySnapshot({
			...emptySnapshot, isStreaming: true,
			messages: [{ role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "gh_list_components", arguments: {} }] }],
		});
		actions.applyAgentEvent({ type: "tool_execution_end", toolCallId: "tool-1", result: "Tool failed", isError: true });
		expect(store.getState().session.messages).toMatchObject([{ tools: [{ id: "tool-1", status: "error", detail: "Tool failed" }] }]);
	});

	it.each([true, false])("unlocks provider controls after a missed auth result and reconnect, authenticated=%s", (authenticated) => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.completeAuth();
		actions.startAuth("openai", "Signing in…");
		actions.setAuthNotice("Open sign-in", "https://example.com/login", "Sign in");
		actions.setConnection("disconnected", "Closed");
		actions.applySnapshot({
			...emptySnapshot,
			providers: [{ id: "openai", name: "OpenAI", authenticated, authMethods: [{ type: "api_key", label: "API key" }] }],
		});
		expect(store.getState().auth).toEqual({ busy: false, provider: null, notice: null, error: null, completedCount: 1 });
		expect(store.getState().providers[0]?.authenticated).toBe(authenticated);
	});

	it("keeps an ongoing auth flow when an unrelated snapshot arrives on the same connection", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.startAuth("openai", "Signing in…");
		actions.applySnapshot(emptySnapshot);
		expect(store.getState().auth).toMatchObject({ busy: true, provider: "openai", notice: "Signing in…" });
	});

	it("hydrates a session snapshot without inventing a browser-side session", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applySnapshot({
			sessionId: "session-1",
			sessionName: "Facade study",
			isStreaming: false,
			thinkingLevel: "high",
			availableThinkingLevels: ["off", "high"],
			model: { provider: "openai", id: "gpt-5" },
			models: [{ provider: "openai", id: "gpt-5" }],
			providers: [{ id: "openai", name: "OpenAI", authenticated: true, authMethods: [{ type: "api_key", label: "OpenAI API key" }] }],
			messages: [{ id: "user-1", role: "user", content: "Inspect this canvas" }],
		});
		expect(store.getState().connection.status).toBe("connected");
		expect(store.getState().session).toMatchObject({ id: "session-1", name: "Facade study", isStreaming: false });
		expect(store.getState().session.messages).toMatchObject([{ role: "user", text: "Inspect this canvas" }]);
		expect(store.getState().selectedModel).toEqual({ provider: "openai", id: "gpt-5" });
	});

	it("keeps streamed text and tool status on the active assistant message", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.applyAgentEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking " } });
		actions.applyAgentEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: { query: "slider" } });
		actions.applyAgentEvent({ type: "tool_execution_end", toolCallId: "tool-1", result: "Found 3", isError: false });
		actions.applyAgentEvent({ type: "agent_end" });
		expect(store.getState().session.messages).toMatchObject([{ id: "assistant-1", text: "Checking ", streaming: false, tools: [{ id: "tool-1", status: "complete", args: { query: "slider" }, detail: "Found 3" }] }]);
		expect(store.getState().session.isStreaming).toBe(false);
	});

	it("shows a provider failure instead of treating it as an empty response", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.applyAgentEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "Request failed",
				diagnostics: [{ type: "provider_transport_failure", error: { message: "WebSocket error" } }],
			},
		});
		expect(store.getState().session.messages).toMatchObject([{ id: "assistant-1", text: "", error: "Request failed: WebSocket error", streaming: false }]);
	});

	it("uses the completed assistant payload when no text deltas arrived", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.applyAgentEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Recovered final answer" }], stopReason: "stop" } });
		expect(store.getState().session.messages).toMatchObject([{ id: "assistant-1", text: "Recovered final answer", streaming: false }]);
	});

	it("starts a fresh assistant message instead of appending to a previous turn", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.applyAgentEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "First answer" } });
		actions.applyAgentEvent({ type: "agent_end" });
		actions.addUserMessage("Second question", "prompt");
		expect(store.getState().session.isStreaming).toBe(true);
		actions.applyAgentEvent({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "gh_apply_graph", args: {} });
		expect(store.getState().session.messages.map((message) => message.role)).toEqual(["assistant", "user", "assistant"]);
		expect(store.getState().session.messages[0]?.tools).toHaveLength(0);
		expect(store.getState().session.messages[2]?.tools).toMatchObject([{ id: "tool-2", status: "running" }]);
	});

	it("keeps tool arguments when the execution event repeats a tool already announced in the stream", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.applyAgentEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", id: "tool-1", toolName: "gh_list_components" } });
		actions.applyAgentEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "gh_list_components", args: { search: "panel" } });
		expect(store.getState().session.messages[0]?.tools).toMatchObject([{ id: "tool-1", args: { search: "panel" }, status: "running" }]);
	});

	it("tracks the provider sign-in flow and clears it on completion", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.startAuth("openai", "Checking the API key…");
		expect(store.getState().auth).toMatchObject({ busy: true, provider: "openai", notice: "Checking the API key…", error: null });
		actions.failAuth("Invalid key");
		expect(store.getState().auth).toMatchObject({ busy: false, error: "Invalid key", notice: null });
		actions.startAuth("openai", "Checking the API key…");
		actions.completeAuth();
		expect(store.getState().auth).toMatchObject({ busy: false, error: null, completedCount: 1 });
	});

	it("settles streaming state when the connection drops", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.setConnection("disconnected", "Closed");
		expect(store.getState().session.isStreaming).toBe(false);
		expect(store.getState().session.messages[0]?.streaming).toBe(false);
	});

	it("shows one agent input dialog at a time", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		const first = { requestId: "first", kind: "input" as const, title: "Name it" };
		const second = { requestId: "second", kind: "confirm" as const, title: "Continue?" };
		actions.queueUiRequest(first);
		actions.queueUiRequest(second);
		expect(store.getState().activeUiRequest?.requestId).toBe("first");
		expect(store.getState().pendingUiRequests).toHaveLength(1);
		actions.resolveUiRequest();
		expect(store.getState().activeUiRequest?.requestId).toBe("second");
	});

	it("ignores a pending UI request replayed after reconnect", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		const request = { requestId: "pending", kind: "confirm" as const, title: "Continue?" };
		actions.queueUiRequest(request);
		actions.queueUiRequest(request);
		expect(store.getState().activeUiRequest?.requestId).toBe("pending");
		expect(store.getState().pendingUiRequests).toHaveLength(0);
	});

	it("isolates each app's conversation, auth, and request queue", () => {
		const first = createHopperStore();
		const second = createHopperStore();
		first.getState().actions.addUserMessage("First app", "prompt");
		first.getState().actions.startAuth("openai", "Signing in");
		first.getState().actions.queueUiRequest({ requestId: "first", kind: "confirm", title: "Continue?" });
		expect(second.getState().session.messages).toEqual([]);
		expect(second.getState().auth.busy).toBe(false);
		expect(second.getState().activeUiRequest).toBeNull();
		expect(first.getState().actions).not.toBe(second.getState().actions);
	});

	it("notifies subscribers of disconnect only after streaming and auth have settled", () => {
		const store = createHopperStore();
		const { actions } = store.getState();
		actions.setConnection("connected", "Ready");
		actions.applyAgentEvent({ type: "message_start", message: { id: "assistant-1", role: "assistant" } });
		actions.startAuth("openai", "Signing in");
		actions.setWorkingMessage("Inspecting the canvas");
		const observed: unknown[] = [];
		const unsubscribe = store.subscribe((state) => observed.push({ connection: state.connection.status, streaming: state.session.isStreaming, authBusy: state.auth.busy, working: state.workingMessage }));
		actions.setConnection("disconnected", "Closed");
		unsubscribe();
		expect(observed).toEqual([{ connection: "disconnected", streaming: false, authBusy: false, working: null }]);
		expect(store.getState().actions).toBe(actions);
	});

});
