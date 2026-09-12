import type { RuntimeStatus } from "../../../src/protocol/v2.js";
import type { SetHopperState } from "./hopper-types";

export function createRuntimeActions(set: SetHopperState) {
	return {
		setRuntimeStatus: (status: RuntimeStatus) => set({ runtimeStatus: status, runtimeStatusError: null }),
		setRuntimeStatusError: (error: string) => set({ runtimeStatusError: error }),
		setBackendDetail: (detail: string) => set({ backendDetail: detail }),
	};
}
