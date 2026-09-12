import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BACKEND_POLL_INTERVAL_MS } from "../config.js";
import {
	formatBackendEndpoint,
	probeBackend,
	type BackendStatus,
} from "../infra/backend-status.js";

const STATUS_KEY = "hopper-backend";
const WIDGET_KEY = "hopper-backend";

function renderStatusLine(
	theme: ExtensionContext["ui"]["theme"],
	status: BackendStatus
): string {
	const endpoint = formatBackendEndpoint();
	if (status.online) {
		return (
			theme.fg("success", "● ") +
			theme.fg("accent", "Hopper/Rhino") +
			theme.fg("dim", ` runtime online (${endpoint})`)
		);
	}
	const detail = status.error ? ` — ${status.error}` : "";
	return (
		theme.fg("error", "○ ") +
		theme.fg("warning", "Hopper/Rhino") +
		theme.fg("dim", ` runtime offline (${endpoint})${detail}`)
	);
}

export function registerBackendStatusUI(pi: ExtensionAPI): void {
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let probing = false;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI || probing) return;
		probing = true;
		try {
			const status = await probeBackend();
			const line = renderStatusLine(ctx.ui.theme, status);
			ctx.ui.setWidget(WIDGET_KEY, [line], { placement: "aboveEditor" });
			ctx.ui.setStatus(
				STATUS_KEY,
				status.online
					? ctx.ui.theme.fg("success", "Hopper ● online")
					: ctx.ui.theme.fg("error", "Hopper ○ offline")
			);
		} finally {
			probing = false;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		if (pollTimer) clearInterval(pollTimer);
		await refresh(ctx);

		pollTimer = setInterval(() => {
			void refresh(ctx);
		}, BACKEND_POLL_INTERVAL_MS);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = undefined;
		}
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.registerCommand("hopper-backend", {
		description: "Refresh Hopper/Rhino runtime connection status",
		handler: async (_args, ctx) => {
			await refresh(ctx);
			ctx.ui.notify("Backend status refreshed", "info");
		},
	});
}
