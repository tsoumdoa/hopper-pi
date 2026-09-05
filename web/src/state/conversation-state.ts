import type { ConversationMessage, HopperState, ToolCall } from "./hopper-types";
import { identifier } from "./identifiers";

export type ConversationState = Pick<HopperState, "session" | "workingMessage">;

export function textFromContent(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("");
}

export function messageError(message: Record<string, unknown>): string | undefined {
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

export function thinkingFromContent(content: Record<string, unknown>[]) {
	return content
		.filter((part) => part.type === "thinking")
		.map((part) => String(part.thinking ?? part.text ?? ""))
		.join("\n");
}

// Follow-ups can appear after the assistant that is still receiving events.
function updateActiveAssistant(state: ConversationState, update: (message: ConversationMessage) => ConversationMessage): ConversationState {
	const messages = [...state.session.messages];
	let index = messages.findIndex((message) => message.id === state.session.activeAssistantId);
	if (index === -1) {
		index = messages.length;
		messages.push({ id: identifier("assistant"), role: "assistant", text: "", thinking: "", streaming: true, tools: [] });
	}
	messages[index] = update(messages[index]);
	return { ...state, session: { ...state.session, messages, activeAssistantId: messages[index].id } };
}

function startTool(state: ConversationState, id: string, name: string, args: unknown, executing = false) {
	// A snapshot can contain the call before its execution-start event arrives.
	const owner = state.session.messages.find((message) => message.tools.some((tool) => tool.id === id));
	if (owner) state = { ...state, session: { ...state.session, activeAssistantId: owner.id } };
	return updateActiveAssistant(state, (message) => {
		const existing = message.tools.find((tool) => tool.id === id);
		if (existing) {
			if (args === undefined || (!executing && existing.args !== undefined)) return message;
			return { ...message, tools: message.tools.map((tool) => tool.id === id ? {
				...tool,
				args,
				// Snapshot arguments may be incomplete. Keep any actual output already received.
				detail: tool.detail === tool.args || tool.detail === undefined ? args : tool.detail,
			} : tool) };
		}
		return { ...message, tools: [...message.tools, { id, name, args, detail: args, status: "running" }] };
	});
}

function finishTool(state: ConversationState, id: string, detail: unknown, isError: boolean, running = false) {
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

export function settleMessages(state: ConversationState, isStreaming: boolean): ConversationState {
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

function finishAssistantMessage(state: ConversationState, event: Record<string, unknown>): ConversationState {
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

export function reduceAgentEvent(state: ConversationState, event: Record<string, unknown>): ConversationState {
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
		return startTool(state, String(event.toolCallId ?? event.id ?? identifier("tool")), String(event.toolName ?? event.name ?? "Tool call"), event.args ?? event.arguments ?? event.input, true);
	}
	if (type === "tool_execution_update") {
		return finishTool(state, String(event.toolCallId), event.partialResult, false, true);
	}
	if (type === "tool_execution_end") {
		return finishTool(state, String(event.toolCallId ?? event.id), event.result, Boolean(event.isError ?? event.error));
	}
	return state;
}
