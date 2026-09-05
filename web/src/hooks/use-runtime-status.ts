import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { RuntimeStatus } from "../../../src/protocol/v2.js";
import type { HopperAction } from "../state/hopper-reducer";
import { mockRuntimeStatus } from "../mocks/hopper-mock";

const POLL_INTERVAL_MS = 3_000;

export async function requestRuntimeStatus(token: string, request: typeof fetch = fetch): Promise<RuntimeStatus> {
	const response = await request("/api/runtime-status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
	if (!response.ok) throw new Error(`status request returned HTTP ${response.status}`);
	return response.json() as Promise<RuntimeStatus>;
}

export function useRuntimeStatus(token: string, connected: boolean, dispatch: Dispatch<HopperAction>) {
	const [refreshing, setRefreshing] = useState(false);
	const inFlight = useRef(false);

	const refresh = useCallback(async () => {
		if (!token || !connected) return;
		if (import.meta.env.MODE === "mock") {
			dispatch({ type: "runtime-status", status: mockRuntimeStatus });
			return;
		}
		if (inFlight.current) return;
		inFlight.current = true;
		setRefreshing(true);
		try {
			dispatch({ type: "runtime-status", status: await requestRuntimeStatus(token) });
		} catch (error) {
			dispatch({ type: "runtime-status-error", error: error instanceof Error ? error.message : String(error) });
		} finally {
			inFlight.current = false;
			setRefreshing(false);
		}
	}, [connected, dispatch, token]);

	useEffect(() => {
		if (!token || !connected) return;
		void refresh();
		const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [connected, refresh, token]);

	return { refresh, refreshing };
}
