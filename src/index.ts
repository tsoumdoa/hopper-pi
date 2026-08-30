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
 *   - tools/        → Pi extension tool definitions (rh_run_script + GH tools)
 *
 * Backend ports (configurable via env vars):
 *   - PUB  :5555  (event publishing)
 *   - PUSH :5556  (command submission)
 *   - REQ  :5557  (query/response)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	beginTransactionPair,
	cancelTransactionPair,
	commitTransactionPair,
} from "./services/transaction-lifecycle.js";
import { probeBackend } from "./infra/backend-status.js";
import { registerBackendStatusUI } from "./ui/backend-status.js";
import { registerToolSchemasUI } from "./ui/tool-schemas.js";
import {
	ALL_TOOLS,
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	type HopperToolCatalogEntry,
} from "./tools/index.js";
import {
	createHopperSearchToolsTool,
	resetProgressiveActiveTools,
	shouldResetProgressiveTools,
} from "./tools/hopper-search-tools.js";
import { withBackendGuard } from "./tools/with-backend-guard.js";
import { ENV, isProgressiveToolsEnvEnabled } from "./config.js";
import {
	createRhinoCaptureModelController,
	promptWantsVisualCapture,
	rhinoCaptureUnavailableGuidance,
} from "./services/rhino-capture-model.js";
import {
	promptTargetsGrasshopper,
	promptTargetsRhino,
	rhinoRoutingGuidance,
} from "./services/prompt-routing.js";

const PROGRESSIVE_TOOLS_FLAG = "hopper-progressive-tools";

function isProgressiveToolsEnabled(pi: ExtensionAPI): boolean {
	const flag = pi.getFlag(PROGRESSIVE_TOOLS_FLAG);
	if (typeof flag === "boolean") return flag;
	return isProgressiveToolsEnvEnabled();
}

export default function hopperPiExtension(pi: ExtensionAPI) {
	pi.registerFlag(PROGRESSIVE_TOOLS_FLAG, {
		type: "boolean",
		default: isProgressiveToolsEnvEnabled(),
		description:
			"Start with a small Hopper core and activate specialists via hopper_search_tools. " +
			`Off by default (all Hopper tools active). Also set ${ENV.HOPPER_PROGRESSIVE_TOOLS}=1.`,
	});

	// ── Register Grasshopper/Rhino tools + progressive loader ───────

	for (const tool of ALL_TOOLS) {
		pi.registerTool(withBackendGuard(tool));
	}

	let catalog: readonly HopperToolCatalogEntry[] = HOPPER_REGISTERED_CATALOG;
	const getCatalog = () => catalog;
	const progressive = isProgressiveToolsEnabled(pi);

	const searchTool = createHopperSearchToolsTool(pi, getCatalog);
	if (progressive) {
		pi.registerTool(searchTool);
	}

	catalog = [
		...HOPPER_REGISTERED_CATALOG,
		{
			tool: searchTool,
			group: "interaction",
			keywords: ["search tools", "activate", "discover"],
			alwaysActive: true,
		},
		RH_CAPTURE_VIEW_CATALOG_ENTRY,
	];

	registerBackendStatusUI(pi);
	registerToolSchemasUI(pi, getCatalog);

	const captureModel = createRhinoCaptureModelController(pi);

	// ── Lifecycle: notify on load ──────────────────────────────────

	pi.on("session_start", async (event, ctx) => {
		const progressive = isProgressiveToolsEnabled(pi);
		if (progressive && shouldResetProgressiveTools(event.reason)) {
			resetProgressiveActiveTools(pi, catalog);
		}

		// Compose with rh_capture_view after core reset so image gating stays authoritative.
		captureModel.syncCaptureToolForModel(ctx.model);
		void probeBackend();
		ctx.ui.notify(
			progressive
				? "🦘 Hopper Pi: progressive tools on (core + hopper_search_tools); specialists load on demand"
				: "🦘 Hopper Pi: rh_run_script (Rhino doc) + Grasshopper canvas tools loaded",
			"info",
		);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt ?? "";
		if (!promptTargetsRhino(prompt)) return;

		const wantsVisualCapture = promptWantsVisualCapture(prompt);
		if (wantsVisualCapture) {
			await captureModel.maybeSwitchToMultimodalFallback(ctx);
		}

		const captureToolActive = captureModel.isCaptureToolActive();
		const captureGuidance = wantsVisualCapture
			? (captureToolActive ? "" : rhinoCaptureUnavailableGuidance(ctx.model))
			: "";
		const guidance = [
			rhinoRoutingGuidance(promptTargetsGrasshopper(prompt)),
			captureGuidance,
		].filter(Boolean).join(" ");

		// Keep per-request routing out of conversation history; otherwise every Rhino
		// turn adds another hidden message that persists for the rest of the session.
		return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
	});

	pi.on("model_select", async (event) => {
		captureModel.syncCaptureToolForModel(event.model);
	});

	// ── Agent undo (one GH undo step + one Rhino undo step per prompt) ─

	pi.on("agent_start", async () => {
		await beginTransactionPair();
	});

	pi.on("agent_end", async (event) => {
		if ("willRetry" in event && event.willRetry) {
			return;
		}
		await commitTransactionPair();
	});

	pi.on("session_shutdown", async () => {
		await cancelTransactionPair();
	});
}
