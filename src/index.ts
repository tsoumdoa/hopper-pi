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

export default function hopperPiExtension(pi: ExtensionAPI) {
	// ── Register all Grasshopper canvas tools ───────────────────────

	for (const tool of ALL_TOOLS) {
		pi.registerTool(withBackendGuard(tool));
	}

	registerBackendStatusUI(pi);

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

	const RHINO_DOC_RE =
		/(?:^|[^\w])(rhino\s+doc(?:ument)?s?|viewports?|views?|cameras?|screenshots?|captures?|visual\s+context|bakes?|layers?|selections?|select\s+|named\s*views?|cplanes?|construction\s+planes?|blocks?|materials?|rhinoscript|scriptcontext|rh_run_script|rh_capture_view|rh_view_control|_circle|_line|_extrude)(?=[^\w]|$)/i;
	const GH_CANVAS_RE =
		/(?:^|[^\w])(grasshopper|gh\s|canvases?|canvas|components?|wires?|sliders?|gh_edit|gh_get_canvas)(?=[^\w]|$)/i;

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt ?? "";
		if (!RHINO_DOC_RE.test(prompt)) return;

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

		const visualCaptureGuidance = wantsVisualCapture
			? (captureToolActive
				? rhinoVisualCaptureGuidance()
				: rhinoCaptureUnavailableGuidance(ctx.model))
			: "";
		const both = GH_CANVAS_RE.test(prompt);
		const content = both
			? "This prompt may need both Rhino document and Grasshopper canvas changes. " +
				"Use rh_run_script or rh_view_control for RhinoDoc/viewport; use gh_* for canvas wiring and components. " +
				visualCaptureGuidance
			: "This prompt targets the Rhino document. Use rh_run_script (command/python/csharp). " +
				"Prefer rh_view_control for viewport/camera manipulation. " +
				"Do not use gh_edit_* unless you also need Grasshopper canvas changes. " +
				visualCaptureGuidance;

		return {
			message: {
				customType: "hopper-rhino-routing",
				display: false,
				content,
			},
		};
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
