import type { AuthFlow, HopperState } from "./hopper-types";

export const DEFAULT_SESSION_NAME = "New Rhino session";
export const CONNECTED_DETAIL = "Private Hopper host on this computer";

export const initialAuth: AuthFlow = { busy: false, provider: null, notice: null, error: null, completedCount: 0 };

export function createInitialHopperState(): HopperState {
	return {
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
		auth: { ...initialAuth },
	};
}
