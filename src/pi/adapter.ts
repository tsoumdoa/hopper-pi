import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HopperToolSpec } from "../core/tool-contract.js";
import { isRhinoVisualCaptureAllowed } from "../services/rhino-visual-consent.js";
import { modelSupportsImages } from "../services/model-capabilities.js";

export type PiToolPresentation = Pick<ToolDefinition, "renderCall" | "renderResult" | "renderShell">;

export function toPiTool(
	spec: HopperToolSpec,
	presentation: Partial<PiToolPresentation> = {},
): ToolDefinition {
	return defineTool({
		name: spec.name,
		label: spec.title,
		description: spec.description,
		promptSnippet: spec.promptSnippet,
		promptGuidelines: spec.promptGuidelines,
		parameters: spec.inputSchema,
		prepareArguments: spec.prepareArguments,
		...presentation,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return spec.execute(params, {
				toolCallId,
				signal,
				reportProgress: onUpdate,
				supportsImages: modelSupportsImages(ctx.model),
				captureAllowed: isRhinoVisualCaptureAllowed(),
				hostContext: ctx,
			});
		},
	});
}
