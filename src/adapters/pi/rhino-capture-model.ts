import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MULTIMODAL_FALLBACK_MODEL } from "../../config.js";
import { withBackendGuard } from "../../tools/with-backend-guard.js";
import { rhCaptureViewTool } from "./operation-tools.js";
import {
	describeModel,
	modelSupportsImages,
	type ModelLike,
	parseProviderModel,
	RH_CAPTURE_VIEW_TOOL,
} from "../../services/model-capabilities.js";

export function promptWantsVisualCapture(prompt: string): boolean {
	return /(?:^|[^\w])(screenshots?|captures?|visual\s+context|image|see\s+the\s+(?:model|view)|look\s+at\s+the\s+(?:model|view)|rh_capture_view)(?=[^\w]|$)/i.test(prompt);
}

export function promptOverridesVisualCaptureRestriction(prompt: string): boolean {
	return /(?:^|[^\w])(?:allow|enable|override|turn\s+on|use)\b.{0,80}\b(?:screenshots?|captures?|visual\s+context|rh_capture_view)(?=[^\w]|$)/i.test(prompt) ||
		/(?:^|[^\w])(?:screenshots?|captures?|visual\s+context|rh_capture_view)\b.{0,80}\b(?:allowed|enabled|ok|okay|yes|override)(?=[^\w]|$)/i.test(prompt);
}

export function rhinoCaptureUnavailableGuidance(model: ModelLike | null | undefined): string {
	return `${describeModel(model)} does not support image input, so Rhino viewport screenshots are unavailable. ` +
		"If visual context is needed, tell the user to choose a multimodal model in Pi. " +
		"Otherwise continue with rh_view_control, rh_query_objects, gh_get_canvas, gh_get_canvas_errors, or rh_run_script.";
}

export function shouldAskVisualCapturePermission(options: {
	captureToolActive: boolean;
	hasDecision: boolean;
	hasUI: boolean;
	requestingCapture?: boolean;
	allowReconsider?: boolean;
	overrideConfigured?: boolean;
}): boolean {
	const requestingCapture = options.requestingCapture ?? true;
	const allowReconsider = options.allowReconsider ?? false;
	return options.captureToolActive &&
		options.hasUI &&
		requestingCapture &&
		!options.overrideConfigured &&
		(!options.hasDecision || allowReconsider);
}

export function createRhinoCaptureModelController(
	pi: ExtensionAPI,
	fallbackModelId = MULTIMODAL_FALLBACK_MODEL,
) {
	let captureToolRegistered = false;

	function ensureCaptureToolRegistered(): void {
		if (captureToolRegistered || pi.getAllTools().some((tool) => tool.name === RH_CAPTURE_VIEW_TOOL)) {
			captureToolRegistered = true;
			return;
		}
		pi.registerTool(withBackendGuard(rhCaptureViewTool));
		captureToolRegistered = true;
	}

	/**
	 * Drive rh_capture_view activation from the current model, not from a
	 * one-shot "we hid it" latch: the progressive loader also resets the active
	 * set on session start, so this must re-activate any registered capture tool
	 * whenever the model supports images.
	 */
	function syncCaptureToolForModel(model: ModelLike | null | undefined): void {
		const supportsImages = modelSupportsImages(model);

		if (!supportsImages) {
			const active = pi.getActiveTools();
			if (active.includes(RH_CAPTURE_VIEW_TOOL)) {
				pi.setActiveTools(active.filter((name) => name !== RH_CAPTURE_VIEW_TOOL));
			}
			return;
		}

		ensureCaptureToolRegistered();
		const active = pi.getActiveTools();
		if (active.includes(RH_CAPTURE_VIEW_TOOL)) return;
		if (!pi.getAllTools().some((tool) => tool.name === RH_CAPTURE_VIEW_TOOL)) return;
		pi.setActiveTools([...active, RH_CAPTURE_VIEW_TOOL]);
	}

	function isCaptureToolActive(): boolean {
		return pi.getActiveTools().includes(RH_CAPTURE_VIEW_TOOL);
	}

	async function maybeSwitchToMultimodalFallback(ctx: ExtensionContext): Promise<void> {
		if (modelSupportsImages(ctx.model) || !ctx.hasUI || !fallbackModelId) return;

		const fallback = parseProviderModel(fallbackModelId);
		if (!fallback) {
			ctx.ui.notify(
				`Invalid HOPPER_MULTIMODAL_FALLBACK="${fallbackModelId}". Use provider/model.`,
				"warning",
			);
			return;
		}

		const fallbackModel = ctx.modelRegistry.find(fallback.provider, fallback.model);
		if (!fallbackModel) {
			ctx.ui.notify(
				`Configured multimodal fallback model was not found: ${fallbackModelId}`,
				"warning",
			);
			return;
		}
		if (!modelSupportsImages(fallbackModel)) {
			ctx.ui.notify(
				`Configured multimodal fallback does not advertise image input: ${fallbackModelId}`,
				"warning",
			);
			return;
		}

		const switchLabel = `Switch to ${fallbackModelId}`;
		const choice = await ctx.ui.select(
			`${describeModel(ctx.model)} does not support image input. Switch to ${fallbackModelId} for Rhino screenshots?`,
			[
				switchLabel,
				"Continue without screenshots",
			],
			{ signal: ctx.signal },
		);
		if (choice !== switchLabel) return;

		const switched = await pi.setModel(fallbackModel);
		if (!switched) {
			ctx.ui.notify(`Could not switch to ${fallbackModelId}; no API key may be configured.`, "error");
			return;
		}
		syncCaptureToolForModel(fallbackModel);
	}

	return {
		syncCaptureToolForModel,
		isCaptureToolActive,
		maybeSwitchToMultimodalFallback,
	};
}
