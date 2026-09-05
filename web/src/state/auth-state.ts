import type { SetHopperState } from "./hopper-types";
import { initialAuth } from "./initial-state";

export function createAuthActions(set: SetHopperState) {
	return {
		startAuth: (provider: string, notice: string) => set((state) => ({ auth: { ...state.auth, busy: true, provider, notice, url: undefined, label: undefined, error: null } })),
		setAuthNotice: (notice: string, url?: string, label?: string) => set((state) => ({ auth: { ...state.auth, notice, url, label, error: null } })),
		failAuth: (error: string) => set((state) => ({ auth: { ...state.auth, busy: false, notice: null, url: undefined, label: undefined, error } })),
		completeAuth: () => set((state) => ({ auth: { ...initialAuth, completedCount: state.auth.completedCount + 1 } })),
		resetAuth: () => set((state) => ({ auth: { ...initialAuth, completedCount: state.auth.completedCount } })),
	};
}
