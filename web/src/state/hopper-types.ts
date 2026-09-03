export type ToolCall = {
	id: string;
	name: string;
	detail: unknown;
	status: "running" | "complete" | "error";
};

export type ConversationMessage = {
	id: string;
	role: "user" | "assistant";
	text: string;
	thinking: string;
	streaming: boolean;
	tools: ToolCall[];
};

export type ModelSummary = { provider: string; id: string; name?: string };
export type ProviderSummary = { id: string; name: string; authenticated: boolean };
export type UiOption = { id: string; value: string; label: string; description?: string };
export type UiRequest = { requestId: string; kind: "select" | "confirm" | "input" | "editor" | "auth"; title: string; description?: string; options?: UiOption[]; placeholder?: string; prefill?: string; secret?: boolean };
export type ToastNotice = { id: string; message: string; level: "info" | "warning" | "error"; url?: string; label?: string };

export type HopperState = {
	connection: { status: "connecting" | "authenticating" | "connected" | "disconnected" | "error"; detail: string; reconnectAttempt: number };
	session: { id: string | null; name: string; messages: ConversationMessage[]; isStreaming: boolean };
	models: ModelSummary[];
	providers: ProviderSummary[];
	selectedModel: ModelSummary | null;
	thinkingLevel: string;
	availableThinkingLevels: string[];
	pendingUiRequests: UiRequest[];
	activeUiRequest: UiRequest | null;
	notifications: ToastNotice[];
	runtimeStatus: Record<string, unknown> | null;
	runtimeStatusError: string | null;
	backendDetail: string;
};
