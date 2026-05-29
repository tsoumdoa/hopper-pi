/**
 * Hopper Pi — Grasshopper Canvas Tools Extension for Pi
 *
 * This extension gives the AI agent direct access to inspect and edit
 * a Grasshopper canvas running in Rhino via ZeroMQ.
 *
 * Architecture:
 *   - infra/        → ZMQ transport (REQ/REP, PUSH, SUB sockets)
 *   - types/        → Message & domain schemas
 *   - services/     → XML parser (Grasshopper archive → JSON)
 *   - tools/        → Pi extension tool definitions (14 tools)
 *
 * Backend ports (configurable via env vars):
 *   - PUB  :5555  (event publishing)
 *   - PUSH :5556  (command submission)
 *   - REQ  :5557  (query/response)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	beginAgentTransaction,
	cancelAgentTransaction,
	commitAgentTransaction,
} from "./services/agent-transaction.js";
import { probeBackend } from "./infra/backend-status.js";
import { registerBackendStatusUI } from "./ui/backend-status.js";
import { ALL_TOOLS } from "./tools/index.js";
import { withBackendGuard } from "./tools/with-backend-guard.js";

export default function hopperPiExtension(pi: ExtensionAPI) {
	// ── Register all Grasshopper canvas tools ───────────────────────

	for (const tool of ALL_TOOLS) {
		pi.registerTool(withBackendGuard(tool));
	}

	registerBackendStatusUI(pi);

	// ── Lifecycle: notify on load ──────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		void probeBackend();
		ctx.ui.notify(
			"\u{1F998} Hopper Pi: Grasshopper canvas tools loaded (14 tools)",
			"info"
		);
	});

	// ── Agent undo transaction (one GH undo/redo step per prompt) ───

	pi.on("agent_start", async () => {
		try {
			await beginAgentTransaction();
		} catch (err) {
			// console.error("[hopper-pi] Failed to begin agent transaction:", err);
		}
	});

	pi.on("agent_end", async (event) => {
		if ("willRetry" in event && event.willRetry) {
			return;
		}

		try {
			await commitAgentTransaction();
		} catch (err) {
			// console.error("[hopper-pi] Failed to commit agent transaction:", err);
		}
	});

	pi.on("session_shutdown", async () => {
		try {
			await cancelAgentTransaction();
		} catch {
			// Backend may already be disconnected during shutdown.
		}
	});
}
