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
import { ALL_TOOLS } from "./tools/index.js";
import { withBackendGuard } from "./tools/with-backend-guard.js";
import {
	hasRhinoVisualCaptureDecision,
	isRhinoVisualCaptureAllowed,
	isRhinoVisualCaptureOverrideConfigured,
	resetRhinoVisualCaptureState,
	rhinoVisualCaptureGuidance,
	setRhinoVisualCaptureConsent,
	VISUAL_CAPTURE_ALLOW_SESSION_LABEL,
	VISUAL_CAPTURE_DENY_LABEL,
} from "./services/rhino-visual-consent.js";
import {
	createRhinoCaptureModelController,
	promptOverridesVisualCaptureRestriction,
	promptWantsVisualCapture,
	rhinoCaptureUnavailableGuidance,
	shouldAskVisualCapturePermission,
} from "./services/rhino-capture-model.js";
import {
	promptTargetsGrasshopper,
	promptTargetsRhino,
	rhinoRoutingGuidance,
} from "./services/prompt-routing.js";

export default function hopperPiExtension(pi: ExtensionAPI) {
	// ── Register all Grasshopper canvas tools ───────────────────────

	for (const tool of ALL_TOOLS) {
		pi.registerTool(withBackendGuard(tool));
	}

	registerBackendStatusUI(pi);
	registerToolSchemasUI(pi);

	const captureModel = createRhinoCaptureModelController(pi);

	// ── Lifecycle: notify on load ──────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		resetRhinoVisualCaptureState();
		captureModel.syncCaptureToolForModel(ctx.model);
		void probeBackend();
		ctx.ui.notify(
			"\u{1F998} Hopper Pi: rh_run_script (Rhino doc) + Grasshopper canvas tools loaded",
			"info"
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
		const shouldReconsiderDeniedCapture =
			!isRhinoVisualCaptureAllowed() && promptOverridesVisualCaptureRestriction(prompt);
		if (shouldAskVisualCapturePermission({
			captureToolActive,
			hasDecision: hasRhinoVisualCaptureDecision(),
			hasUI: ctx.hasUI,
			requestingCapture: wantsVisualCapture,
			allowReconsider: shouldReconsiderDeniedCapture,
			overrideConfigured: isRhinoVisualCaptureOverrideConfigured(),
		})) {
			const choice = await ctx.ui.select(
				"Allow Hopper to capture Rhino viewport screenshots?",
				[VISUAL_CAPTURE_DENY_LABEL, VISUAL_CAPTURE_ALLOW_SESSION_LABEL],
				{ signal: ctx.signal },
			);
			setRhinoVisualCaptureConsent(choice === VISUAL_CAPTURE_ALLOW_SESSION_LABEL);
		}

		const captureGuidance = wantsVisualCapture
			? (captureToolActive
				? rhinoVisualCaptureGuidance()
				: rhinoCaptureUnavailableGuidance(ctx.model))
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
		resetRhinoVisualCaptureState();
		await cancelTransactionPair();
	});
}
