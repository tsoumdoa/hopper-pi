import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostSnapshot } from "../../../src/host/protocol.js";
import type { HopperState, SendMode } from "./hopper-types";
import { createInitialHopperState, initialAuth } from "./initial-state";
import { createAuthActions } from "./auth-state";
import { createNotificationActions } from "./notifications";
import { createRuntimeActions } from "./runtime-state";
import { reduceAgentEvent, settleMessages } from "./conversation-state";
import { applySnapshot } from "./snapshot";
import { identifier } from "./identifiers";

export type HopperActions = ReturnType<typeof createAuthActions> & ReturnType<typeof createNotificationActions> & ReturnType<typeof createRuntimeActions> & {
	setConnection(status: HopperState["connection"]["status"], detail: string, reconnectAttempt?: number): void;
	applySnapshot(snapshot: HostSnapshot): void;
	applyAgentEvent(event: Record<string, unknown>): void;
	setStreaming(streaming: boolean): void;
	setWorkingMessage(text: string | null): void;
	setSessionTitle(title: string): void;
	addUserMessage(text: string, kind: SendMode): void;
};
export type HopperStoreState = HopperState & { actions: HopperActions };
export type HopperStore = StoreApi<HopperStoreState>;
export type SetHopperState = HopperStore["setState"];

export function createHopperStore() {
	return createStore<HopperStoreState>()((set) => ({
		...createInitialHopperState(),
		actions: {
			...createAuthActions(set),
			...createNotificationActions(set),
			...createRuntimeActions(set),
			setConnection: (status, detail, reconnectAttempt) => set((state) => {
				const connection = { status, detail, reconnectAttempt: reconnectAttempt ?? state.connection.reconnectAttempt };
				const auth = status === "disconnected" || status === "error"
					? { ...initialAuth, completedCount: state.auth.completedCount }
					: state.auth;
				// Connection loss settles the conversation and auth in one update.
				return status === "connected" ? { connection } : { ...settleMessages(state, false), connection, auth };
			}),
			applySnapshot: (snapshot) => set((state) => applySnapshot(state, snapshot)),
			applyAgentEvent: (event) => set((state) => reduceAgentEvent(state, event)),
			setStreaming: (streaming) => set((state) => streaming
				? { session: { ...state.session, isStreaming: true } }
				: settleMessages(state, false)),
			setWorkingMessage: (text) => set({ workingMessage: text }),
			setSessionTitle: (title) => set((state) => ({ session: { ...state.session, name: title } })),
			addUserMessage: (text, kind) => {
				const id = identifier("user");
				set((state) => ({ session: {
					...state.session,
					isStreaming: kind === "prompt" ? true : state.session.isStreaming,
					messages: [...state.session.messages, { id, role: "user", kind, text, thinking: "", streaming: false, tools: [] }],
				} }));
			},
		},
	}));
}
