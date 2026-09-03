import { useEffect } from "react";
import type { Dispatch } from "react";
import type { HopperAction } from "../state/hopper-reducer";
import { mockRuntimeStatus } from "../mocks/hopper-mock";

export function useRuntimeStatus(token: string, connected: boolean, dispatch: Dispatch<HopperAction>, mock = false) {
	useEffect(() => {
		if (!token || !connected) return;
		if (mock) {
			dispatch({ type: "runtime-status", status: mockRuntimeStatus });
			return;
		}
		let cancelled = false;
		const refresh = async () => {
			try {
				const response = await fetch("/api/runtime-status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
				if (!response.ok) throw new Error(`status request returned HTTP ${response.status}`);
				const status = await response.json() as Record<string, unknown>;
				if (!cancelled) dispatch({ type: "runtime-status", status });
			} catch (error) {
				if (!cancelled) dispatch({ type: "runtime-status-error", error: error instanceof Error ? error.message : String(error) });
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 3_000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [connected, dispatch, mock, token]);
}
