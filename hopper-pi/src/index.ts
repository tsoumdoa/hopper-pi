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
import { ALL_TOOLS } from "./tools/index.js";

export default function hopperPiExtension(pi: ExtensionAPI) {
	// ── Register all Grasshopper canvas tools ───────────────────────

	for (const tool of ALL_TOOLS) {
		pi.registerTool(tool);
	}

	// ── Lifecycle: notify on load ──────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify(
			"\u{1F998} Hopper Pi: Grasshopper canvas tools loaded (14 tools)",
			"info"
		);
	});
}
