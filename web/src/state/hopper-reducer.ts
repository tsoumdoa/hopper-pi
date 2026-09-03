import type { ConversationMessage, HopperState, ModelSummary, ToastNotice, ToolCall, UiRequest } from "./hopper-types";

export const initialHopperState: HopperState = {
	connection: { status: "connecting", detail: "Opening the local Hopper host", reconnectAttempt: 0 },
	session: { id: null, name: "New Rhino session", messages: [], isStreaming: false },
	models: [], providers: [], selectedModel: null, thinkingLevel: "off", availableThinkingLevels: [],
	pendingUiRequests: [], activeUiRequest: null, notifications: [], runtimeStatus: null, runtimeStatusError: null,
	backendDetail: "Checking the Hopper/Rhino runtime",
};

export type HopperAction =
	| { type: "connection"; status: HopperState["connection"]["status"]; detail: string; reconnectAttempt?: number }
	| { type: "snapshot"; snapshot: Record<string, unknown> }
	| { type: "agent-event"; event: Record<string, unknown> }
	| { type: "ui-request"; request: UiRequest }
	| { type: "ui-request-resolved" }
	| { type: "toast"; notice: ToastNotice }
	| { type: "dismiss-toast"; id: string }
	| { type: "runtime-status"; status: Record<string, unknown> }
	| { type: "runtime-status-error"; error: string }
	| { type: "backend-detail"; detail: string }
	| { type: "session-title"; title: string }
	| { type: "user-message"; text: string };

function identifier(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function textFromContent(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("");
}

function toStoredMessages(messages: unknown): ConversationMessage[] {
	if (!Array.isArray(messages)) return [];
	const toolResults = new Map<string, { content: unknown; isError: boolean }>();
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const item = message as Record<string, unknown>;
		if (item.role === "toolResult" || item.role === "tool_result") toolResults.set(String(item.toolCallId ?? item.id), { content: item.content, isError: Boolean(item.isError) });
	}
	return messages.flatMap((message) => {
		if (!message || typeof message !== "object") return [];
		const item = message as Record<string, unknown>;
		if (item.role !== "user" && item.role !== "assistant") return [];
		const content = Array.isArray(item.content) ? item.content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object") : [];
		const tools: ToolCall[] = content.filter((part) => ["toolCall", "tool_call", "tool_use"].includes(String(part.type))).map((part) => {
			const id = String(part.id ?? part.toolCallId ?? identifier("tool"));
			const result = toolResults.get(id);
			return { id, name: String(part.name ?? part.toolName ?? "Tool call"), detail: result?.content ?? part.arguments ?? part.input, status: result ? result.isError ? "error" : "complete" : "complete" };
		});
		return [{ id: String(item.id ?? identifier("message")), role: item.role, text: textFromContent(item.content), thinking: content.filter((part) => part.type === "thinking").map((part) => String(part.thinking ?? part.text ?? "")).join("\n"), streaming: false, tools }];
	});
}

function updateLastAssistant(state: HopperState, update: (message: ConversationMessage) => ConversationMessage): HopperState {
	const messages = [...state.session.messages];
	let index = messages.map((message) => message.role).lastIndexOf("assistant");
	if (index === -1) { messages.push({ id: identifier("assistant"), role: "assistant", text: "", thinking: "", streaming: true, tools: [] }); index = messages.length - 1; }
	messages[index] = update(messages[index]);
	return { ...state, session: { ...state.session, messages } };
}

function startTool(state: HopperState, id: string, name: string, detail: unknown) {
	return updateLastAssistant(state, (message) => message.tools.some((tool) => tool.id === id) ? message : { ...message, tools: [...message.tools, { id, name, detail, status: "running" }] });
}

function finishTool(state: HopperState, id: string, detail: unknown, isError: boolean, running = false) {
	return updateLastAssistant(state, (message) => ({ ...message, tools: message.tools.map((tool) => tool.id === id ? { ...tool, detail: detail ?? tool.detail, status: running ? "running" : isError ? "error" : "complete" } : tool) }));
}

function reduceAgentEvent(state: HopperState, event: Record<string, unknown>): HopperState {
	const type = String(event.type ?? "");
	if (["agent_start", "turn_start"].includes(type)) return { ...state, session: { ...state.session, isStreaming: true } };
	if (["agent_end", "agent_settled"].includes(type)) return { ...state, session: { ...state.session, isStreaming: false, messages: state.session.messages.map((message) => ({ ...message, streaming: false })) } };
	if (type === "message_start") {
		const message = (event.message ?? event) as Record<string, unknown>;
		if (message.role !== "assistant") return state;
		return { ...state, session: { ...state.session, messages: [...state.session.messages, { id: String(message.id ?? identifier("assistant")), role: "assistant", text: "", thinking: "", streaming: true, tools: [] }] } };
	}
	if (type === "message_end") return { ...state, session: { ...state.session, messages: state.session.messages.map((message) => ({ ...message, streaming: false })) } };
	if (type === "message_update") {
		const update = (event.assistantMessageEvent ?? event.update ?? event.event ?? event) as Record<string, unknown>;
		const updateType = String(update.type ?? "");
		if (["text_delta", "output_text_delta"].includes(updateType)) return updateLastAssistant(state, (message) => ({ ...message, text: message.text + String(update.delta ?? update.text ?? ""), streaming: true }));
		if (["thinking_delta", "reasoning_delta"].includes(updateType)) return updateLastAssistant(state, (message) => ({ ...message, thinking: message.thinking + String(update.delta ?? update.text ?? ""), streaming: true }));
		if (["toolcall_start", "tool_call_start"].includes(updateType)) return startTool(state, String(update.toolCallId ?? update.id ?? identifier("tool")), String(update.toolName ?? update.name ?? "Tool call"), update.args ?? update.arguments);
	}
	if (["tool_execution_start", "tool_call_start"].includes(type)) return startTool(state, String(event.toolCallId ?? event.id ?? identifier("tool")), String(event.toolName ?? event.name ?? "Tool call"), event.args ?? event.arguments ?? event.input);
	if (["tool_execution_update", "tool_call_update"].includes(type)) return finishTool(state, String(event.toolCallId ?? event.id), event.partialResult ?? event.result ?? event.update, false, true);
	if (["tool_execution_end", "tool_call_end"].includes(type)) return finishTool(state, String(event.toolCallId ?? event.id), event.result, Boolean(event.isError ?? event.error));
	return state;
}

export function hopperReducer(state: HopperState, action: HopperAction): HopperState {
	switch (action.type) {
		case "connection": return { ...state, connection: { status: action.status, detail: action.detail, reconnectAttempt: action.reconnectAttempt ?? state.connection.reconnectAttempt } };
		case "snapshot": {
			const snapshot = action.snapshot;
			const selected = snapshot.model && typeof snapshot.model === "object" ? snapshot.model as ModelSummary : null;
			return { ...state, connection: { status: "connected", detail: "Private Hopper host on this computer", reconnectAttempt: 0 }, session: { id: String(snapshot.sessionId ?? "") || null, name: String(snapshot.sessionName ?? "New Rhino session"), messages: toStoredMessages(snapshot.messages), isStreaming: Boolean(snapshot.isStreaming) }, models: Array.isArray(snapshot.models) ? snapshot.models as ModelSummary[] : state.models, providers: Array.isArray(snapshot.providers) ? snapshot.providers as HopperState["providers"] : state.providers, selectedModel: selected, thinkingLevel: String(snapshot.thinkingLevel ?? state.thinkingLevel), availableThinkingLevels: Array.isArray(snapshot.availableThinkingLevels) ? snapshot.availableThinkingLevels as string[] : state.availableThinkingLevels };
		}
		case "agent-event": return reduceAgentEvent(state, action.event);
		case "user-message": return { ...state, session: { ...state.session, messages: [...state.session.messages, { id: identifier("user"), role: "user", text: action.text, thinking: "", streaming: false, tools: [] }] } };
		case "ui-request": return state.activeUiRequest ? { ...state, pendingUiRequests: [...state.pendingUiRequests, action.request] } : { ...state, activeUiRequest: action.request };
		case "ui-request-resolved": return { ...state, activeUiRequest: state.pendingUiRequests[0] ?? null, pendingUiRequests: state.pendingUiRequests.slice(1) };
		case "toast": return { ...state, notifications: [...state.notifications, action.notice] };
		case "dismiss-toast": return { ...state, notifications: state.notifications.filter((notice) => notice.id !== action.id) };
		case "runtime-status": return { ...state, runtimeStatus: action.status, runtimeStatusError: null };
		case "runtime-status-error": return { ...state, runtimeStatusError: action.error };
		case "backend-detail": return { ...state, backendDetail: action.detail };
		case "session-title": return { ...state, session: { ...state.session, name: action.title } };
	}
}
