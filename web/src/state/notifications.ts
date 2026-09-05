import type { ToastLevel, UiRequest, SetHopperState } from "./hopper-types";
import { identifier } from "./identifiers";

const TOAST_TIMEOUTS: Record<ToastLevel, number> = { info: 6_500, success: 6_500, warning: 8_000, error: 10_000 };

export function createToast(message: string, level: ToastLevel = "info", extra: { url?: string; label?: string } = {}) {
	return {
		id: identifier("toast"),
		message,
		level,
		url: extra.url,
		label: extra.label,
		timeout: extra.url ? 30_000 : TOAST_TIMEOUTS[level],
	};
}

export function createNotificationActions(set: SetHopperState) {
	return {
		toast: (...args: Parameters<typeof createToast>) => {
			const notice = createToast(...args);
			set((state) => ({ notifications: [...state.notifications, notice] }));
		},
		dismissToast: (id: string) => set((state) => ({ notifications: state.notifications.filter((notice) => notice.id !== id) })),
		queueUiRequest: (request: UiRequest) => set((state) => {
			if (state.activeUiRequest?.requestId === request.requestId || state.pendingUiRequests.some((item) => item.requestId === request.requestId)) return state;
			return state.activeUiRequest
				? { pendingUiRequests: [...state.pendingUiRequests, request] }
				: { activeUiRequest: request };
		}),
		resolveUiRequest: () => set((state) => ({ activeUiRequest: state.pendingUiRequests[0] ?? null, pendingUiRequests: state.pendingUiRequests.slice(1) })),
	};
}
