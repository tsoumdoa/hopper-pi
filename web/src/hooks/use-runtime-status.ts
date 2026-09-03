import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { HopperAction } from "../state/hopper-reducer";
import { mockRuntimeStatus } from "../mocks/hopper-mock";

const POLL_INTERVAL_MS = 3_000;

export function useRuntimeStatus(token: string, connected: boolean, dispatch: Dispatch<HopperAction>, mock = false) {
	const [refreshing, setRefreshing] = useState(false);
	const inFlight = useRef(false);

	const refresh = useCallback(async () => {
		if (!token || !connected) return;
		if (mock) {
			dispatch({ type: "runtime-status", status: mockRuntimeStatus });
			return;
		}
		if (inFlight.current) return;
		inFlight.current = true;
		setRefreshing(true);
		try {
			const response = await fetch("/api/runtime-status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
			if (!response.ok) throw new Error(`status request returned HTTP ${response.status}`);
			const status = (await response.json()) as Record<string, unknown>;
			dispatch({ type: "runtime-status", status });
		} catch (error) {
			dispatch({ type: "runtime-status-error", error: error instanceof Error ? error.message : String(error) });
		} finally {
			inFlight.current = false;
			setRefreshing(false);
		}
	}, [connected, dispatch, mock, token]);

	useEffect(() => {
		if (!token || !connected) return;
		void refresh();
		const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [connected, refresh, token]);

	return { refresh, refreshing };
}
