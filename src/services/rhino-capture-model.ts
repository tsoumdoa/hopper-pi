import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MULTIMODAL_FALLBACK_MODEL } from "../config.js";
import {
	describeModel,
	modelSupportsImages,
	parseProviderModel,
} from "./model-capabilities.js";

export function promptWantsVisualCapture(prompt: string): boolean {
	return /(?:^|[^\w])(screenshots?|captures?|visual\s+context|image|see\s+the\s+(?:model|view)|look\s+at\s+the\s+(?:model|view)|rh_capture_view)(?=[^\w]|$)/i.test(prompt);
}

export function createRhinoCaptureModelController(
	pi: ExtensionAPI,
	fallbackModelId = MULTIMODAL_FALLBACK_MODEL,
) {
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
	}

	return {
		maybeSwitchToMultimodalFallback,
	};
}
