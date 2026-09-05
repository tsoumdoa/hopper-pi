import type {
	AuthFlow,
	ConversationMessage,
	HopperState,
	SendMode,
	ToastLevel,
	ToastNotice,
	ToolCall,
	UiRequest,
} from "./hopper-types";
import type { HostSnapshot } from "../../../src/host/protocol.js";
import type { RuntimeStatus } from "../../../src/protocol/v2.js";

export const DEFAULT_SESSION_NAME = "New Rhino session";
export const CONNECTED_DETAIL = "Private Hopper host on this computer";

const initialAuth: AuthFlow = { busy: false, provider: null, notice: null, error: null, completedCount: 0 };

export const initialHopperState: HopperState = {
	connection: { status: "connecting", detail: "Opening the local Hopper host", reconnectAttempt: 0 },
	session: { id: null, name: DEFAULT_SESSION_NAME, messages: [], isStreaming: false, activeAssistantId: null },
	workingMessage: null,
	models: [],
	providers: [],
	selectedModel: null,
	thinkingLevel: "off",
	availableThinkingLevels: [],
	pendingUiRequests: [],
	activeUiRequest: null,
	notifications: [],
	runtimeStatus: null,
	runtimeStatusError: null,
	backendDetail: "Checking the Hopper/Rhino runtime",
	auth: initialAuth,
};

export type HopperAction =
	| { type: "connection"; status: HopperState["connection"]["status"]; detail: string; reconnectAttempt?: number }
	| { type: "snapshot"; snapshot: HostSnapshot }
	| { type: "agent-event"; event: Record<string, unknown> }
	| { type: "streaming"; streaming: boolean }
	| { type: "working-message"; text: string | null }
	| { type: "ui-request"; request: UiRequest }
	| { type: "ui-request-resolved" }
	| { type: "toast"; notice: ToastNotice }
	| { type: "dismiss-toast"; id: string }
	| { type: "runtime-status"; status: RuntimeStatus }
	| { type: "runtime-status-error"; error: string }
	| { type: "backend-detail"; detail: string }
	| { type: "session-title"; title: string }
	| { type: "user-message"; text: string; kind: SendMode }
	| { type: "auth-start"; provider: string; notice: string }
	| { type: "auth-notice"; notice: string; url?: string; label?: string }
	| { type: "auth-error"; error: string }
	| { type: "auth-complete" }
	| { type: "auth-reset" };

function identifier(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

const TOAST_TIMEOUTS: Record<ToastLevel, number> = { info: 6_500, success: 6_500, warning: 8_000, error: 10_000 };

export function createToast(message: string, level: ToastLevel = "info", extra: { url?: string; label?: string } = {}): ToastNotice {
	return {
		id: identifier("toast"),
		message,
		level,
		url: extra.url,
		label: extra.label,
		timeout: extra.url ? 30_000 : TOAST_TIMEOUTS[level],
	};
}

function textFromContent(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("");
}

function messageError(message: Record<string, unknown>): string | undefined {
	let summary: string | undefined;
	if (typeof message.errorMessage === "string" && message.errorMessage.trim()) summary = message.errorMessage;
	if (!summary && typeof message.error === "string" && message.error.trim()) summary = message.error;
	if (message.error && typeof message.error === "object") {
		const detail = (message.error as Record<string, unknown>).message;
		if (!summary && typeof detail === "string" && detail.trim()) summary = detail;
	}
	const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
	const diagnostic = [...diagnostics]
		.reverse()
		.find((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
	const diagnosticError = diagnostic?.error;
	const diagnosticDetail = diagnosticError && typeof diagnosticError === "object"
		? (diagnosticError as Record<string, unknown>).message
		: undefined;
	if (summary && typeof diagnosticDetail === "string" && diagnosticDetail.trim() && diagnosticDetail !== summary) {
		return `${summary}: ${diagnosticDetail}`;
	}
	return summary ?? (message.stopReason === "error" ? "The model request failed." : undefined);
}

function thinkingFromContent(content: Record<string, unknown>[]) {
	return content
		.filter((part) => part.type === "thinking")
		.map((part) => String(part.thinking ?? part.text ?? ""))
		.join("\n");
}

function toStoredMessages(messages: unknown): ConversationMessage[] {
	if (!Array.isArray(messages)) return [];
	const toolResults = new Map<string, { content: unknown; isError: boolean }>();
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const item = message as Record<string, unknown>;
		if (item.role === "toolResult" || item.role === "tool_result") {
			toolResults.set(String(item.toolCallId ?? item.id), { content: item.content, isError: Boolean(item.isError) });
		}
	}
	return messages.flatMap((message) => {
		if (!message || typeof message !== "object") return [];
		const item = message as Record<string, unknown>;
		if (item.role !== "user" && item.role !== "assistant") return [];
		const content = Array.isArray(item.content)
			? item.content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
			: [];
		const tools: ToolCall[] = content
			.filter((part) => ["toolCall", "tool_call", "tool_use"].includes(String(part.type)))
			.map((part) => {
				const id = String(part.id ?? part.toolCallId ?? identifier("tool"));
				const args = part.arguments ?? part.input;
				const result = toolResults.get(id);
				return {
					id,
					name: String(part.name ?? part.toolName ?? "Tool call"),
					args,
					detail: result?.content ?? args,
					status: result?.isError ? "error" : "complete",
				};
			});
		return [{
			id: String(item.id ?? identifier("message")),
			role: item.role,
			text: textFromContent(item.content),
			thinking: thinkingFromContent(content),
			error: item.role === "assistant" ? messageError(item) : undefined,
			streaming: false,
			tools,
		}];
	});
}

// Follow-ups can appear after the assistant that is still receiving events.
function updateActiveAssistant(state: HopperState, update: (message: ConversationMessage) => ConversationMessage): HopperState {
	const messages = [...state.session.messages];
	let index = messages.findIndex((message) => message.id === state.session.activeAssistantId);
	if (index === -1) {
		index = messages.length;
		messages.push({ id: identifier("assistant"), role: "assistant", text: "", thinking: "", streaming: true, tools: [] });
	}
	messages[index] = update(messages[index]);
	return { ...state, session: { ...state.session, messages, activeAssistantId: messages[index].id } };
}

function startTool(state: HopperState, id: string, name: string, args: unknown) {
	return updateActiveAssistant(state, (message) => {
		const existing = message.tools.find((tool) => tool.id === id);
		if (existing) {
			if (args === undefined || existing.args !== undefined) return message;
			return { ...message, tools: message.tools.map((tool) => tool.id === id ? { ...tool, args, detail: tool.detail ?? args } : tool) };
		}
		return { ...message, tools: [...message.tools, { id, name, args, detail: args, status: "running" }] };
	});
}

function finishTool(state: HopperState, id: string, detail: unknown, isError: boolean, running = false) {
	const status: ToolCall["status"] = running ? "running" : isError ? "error" : "complete";
	return {
		...state,
		session: {
			...state.session,
			messages: state.session.messages.map((message) => message.tools.some((tool) => tool.id === id) ? {
				...message,
				tools: message.tools.map((tool) => tool.id === id
					? { ...tool, detail: detail ?? tool.detail, status }
					: tool),
			} : message),
		},
	};
}

function settleMessages(state: HopperState, isStreaming: boolean): HopperState {
	return {
		...state,
		workingMessage: isStreaming ? state.workingMessage : null,
		session: {
			...state.session,
			isStreaming,
			activeAssistantId: isStreaming ? state.session.activeAssistantId : null,
			messages: state.session.messages.map((message) => message.streaming ? { ...message, streaming: false } : message),
		},
	};
}

function finishAssistantMessage(state: HopperState, event: Record<string, unknown>): HopperState {
	const payload = (event.message ?? event) as Record<string, unknown>;
	if (payload.role !== "assistant") return settleMessages(state, state.session.isStreaming);
	const content = Array.isArray(payload.content)
		? payload.content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
		: [];
	const finalText = textFromContent(payload.content);
	const finalThinking = thinkingFromContent(content);
	const error = messageError(payload);
	const updated = updateActiveAssistant(state, (message) => ({
		...message,
		text: finalText || message.text,
		thinking: finalThinking || message.thinking,
		error,
		streaming: false,
	}));
	return settleMessages(updated, updated.session.isStreaming);
}

function reduceAgentEvent(state: HopperState, event: Record<string, unknown>): HopperState {
	const type = String(event.type ?? "");
	if (["agent_start", "turn_start"].includes(type)) return { ...state, session: { ...state.session, isStreaming: true } };
	if (["agent_end", "agent_settled"].includes(type)) return settleMessages(state, false);
	if (type === "message_start") {
		const message = (event.message ?? event) as Record<string, unknown>;
		if (message.role !== "assistant") return state;
		const id = String(message.id ?? identifier("assistant"));
		return {
			...state,
			session: {
				...state.session,
				isStreaming: true,
				activeAssistantId: id,
				messages: [
					...state.session.messages,
					{ id, role: "assistant", text: "", thinking: "", streaming: true, tools: [] },
				],
			},
		};
	}
	if (type === "message_end") return finishAssistantMessage(state, event);
	if (type === "message_update") {
		const update = event.assistantMessageEvent as Record<string, unknown>;
		const updateType = String(update.type ?? "");
		if (updateType === "text_delta") {
			return updateActiveAssistant(state, (message) => ({ ...message, text: message.text + String(update.delta ?? update.text ?? ""), streaming: true }));
		}
		if (updateType === "thinking_delta") {
			return updateActiveAssistant(state, (message) => ({ ...message, thinking: message.thinking + String(update.delta ?? update.text ?? ""), streaming: true }));
		}
		if (updateType === "toolcall_start") {
			return startTool(state, String(update.toolCallId ?? update.id ?? identifier("tool")), String(update.toolName ?? update.name ?? "Tool call"), update.args ?? update.arguments);
		}
		return state;
	}
	if (type === "tool_execution_start") {
		return startTool(state, String(event.toolCallId ?? event.id ?? identifier("tool")), String(event.toolName ?? event.name ?? "Tool call"), event.args ?? event.arguments ?? event.input);
	}
	if (type === "tool_execution_update") {
		return finishTool(state, String(event.toolCallId), event.partialResult, false, true);
	}
	if (type === "tool_execution_end") {
		return finishTool(state, String(event.toolCallId ?? event.id), event.result, Boolean(event.isError ?? event.error));
	}
	return state;
}

export function hopperReducer(state: HopperState, action: HopperAction): HopperState {
	switch (action.type) {
		case "connection": {
			const connection = { status: action.status, detail: action.detail, reconnectAttempt: action.reconnectAttempt ?? state.connection.reconnectAttempt };
			const auth = action.status === "disconnected" || action.status === "error"
				? { ...initialAuth, completedCount: state.auth.completedCount }
				: state.auth;
			// A dropped socket cannot keep streaming; settle any in-flight message.
			return action.status === "connected" ? { ...state, connection } : settleMessages({ ...state, connection, auth }, false);
		}
		case "snapshot": {
			const snapshot = action.snapshot;
			return {
				...state,
				connection: { status: "connected", detail: CONNECTED_DETAIL, reconnectAttempt: 0 },
				session: {
					id: snapshot.sessionId || null,
					name: snapshot.sessionName || DEFAULT_SESSION_NAME,
					messages: toStoredMessages(snapshot.messages),
					isStreaming: Boolean(snapshot.isStreaming),
					activeAssistantId: null,
				},
				workingMessage: snapshot.isStreaming ? state.workingMessage : null,
				models: snapshot.models,
				providers: snapshot.providers,
				selectedModel: snapshot.model ?? null,
				thinkingLevel: snapshot.thinkingLevel,
				availableThinkingLevels: snapshot.availableThinkingLevels,
			};
		}
		case "agent-event":
			return reduceAgentEvent(state, action.event);
		case "streaming":
			return action.streaming ? { ...state, session: { ...state.session, isStreaming: true } } : settleMessages(state, false);
		case "working-message":
			return { ...state, workingMessage: action.text };
		case "user-message":
			return {
				...state,
				session: {
					...state.session,
					isStreaming: action.kind === "prompt" ? true : state.session.isStreaming,
					messages: [
						...state.session.messages,
						{ id: identifier("user"), role: "user", kind: action.kind, text: action.text, thinking: "", streaming: false, tools: [] },
					],
				},
			};
		case "ui-request": {
			const alreadyQueued = state.activeUiRequest?.requestId === action.request.requestId
				|| state.pendingUiRequests.some((request) => request.requestId === action.request.requestId);
			if (alreadyQueued) return state;
			return state.activeUiRequest
				? { ...state, pendingUiRequests: [...state.pendingUiRequests, action.request] }
				: { ...state, activeUiRequest: action.request };
		}
		case "ui-request-resolved":
			return { ...state, activeUiRequest: state.pendingUiRequests[0] ?? null, pendingUiRequests: state.pendingUiRequests.slice(1) };
		case "toast":
			return { ...state, notifications: [...state.notifications, action.notice] };
		case "dismiss-toast":
			return { ...state, notifications: state.notifications.filter((notice) => notice.id !== action.id) };
		case "runtime-status":
			return { ...state, runtimeStatus: action.status, runtimeStatusError: null };
		case "runtime-status-error":
			return { ...state, runtimeStatusError: action.error };
		case "backend-detail":
			return { ...state, backendDetail: action.detail };
		case "session-title":
			return { ...state, session: { ...state.session, name: action.title } };
		case "auth-start":
			return { ...state, auth: { ...state.auth, busy: true, provider: action.provider, notice: action.notice, url: undefined, label: undefined, error: null } };
		case "auth-notice":
			return { ...state, auth: { ...state.auth, notice: action.notice, url: action.url, label: action.label, error: null } };
		case "auth-error":
			return { ...state, auth: { ...state.auth, busy: false, notice: null, url: undefined, label: undefined, error: action.error } };
		case "auth-complete":
			return { ...state, auth: { ...initialAuth, completedCount: state.auth.completedCount + 1 } };
		case "auth-reset":
			return { ...state, auth: { ...initialAuth, completedCount: state.auth.completedCount } };
	}
}
