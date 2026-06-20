import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import { describeModel, modelSupportsImages } from "../services/model-capabilities.js";
import { isRhinoVisualCaptureAllowed } from "../services/rhino-visual-consent.js";
import type { CaptureRhinoViewResponse, RhinoViewMetadata } from "../types/messages.js";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MAX_DIMENSION = 2000;

function clampDimension(value: unknown, fallback: number): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
	return Math.min(Math.max(numeric, 64), MAX_DIMENSION);
}

function formatPoint(point: { x: number; y: number; z: number }): string {
	return `(${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)})`;
}

function formatMetadata(metadata?: RhinoViewMetadata | null): string {
	if (!metadata) return "Captured Rhino viewport.";
	return [
		`Captured Rhino viewport "${metadata.viewName}" (${metadata.width ?? "?"}x${metadata.height ?? "?"}).`,
		`Projection: ${metadata.projection}`,
		`Camera: location=${formatPoint(metadata.cameraLocation)} target=${formatPoint(metadata.cameraTarget)} lens=${metadata.lensLength.toFixed(1)}mm`,
		`CPlane: ${metadata.cplaneName || "(unnamed)"} origin=${formatPoint(metadata.cplaneOrigin)}`,
	].join("\n");
}

export const rhCaptureViewTool = defineTool({
	name: "rh_capture_view",
	label: "Capture Rhino View",
	description:
		"Capture a Rhino viewport screenshot as PNG visual context. " +
		"Permission-gated: this tool only works after the user allows Rhino viewport screenshots for the current Pi session and the selected model supports image input. " +
		"Use sparingly for visual QA, composition, visibility, material/display checks, or ambiguous viewport tasks. " +
		"Use rh_view_control first when a different viewpoint is needed.",
	promptSnippet: "Capture a permission-gated Rhino viewport screenshot as visual context",
	promptGuidelines: [
		"Use rh_capture_view only after visual capture has been allowed for the current Pi session.",
		"Do not rely on rh_capture_view when the user chose to work without visual capture; use text and geometry tools instead.",
		"Use rh_view_control before rh_capture_view when the screenshot needs a standard, named, CPlane-aligned, or camera-specific view.",
	],
	parameters: Type.Object({
		view: Type.Optional(
			Type.String({
				description:
					'Viewport to capture: "active" (default), a standard view (top/front/right/perspective/etc.), or an existing named view name.',
			}),
		),
		width: Type.Optional(
			Type.Number({
				description: `Capture width in pixels. Default ${DEFAULT_WIDTH}, clamped to ${MAX_DIMENSION}.`,
			}),
		),
		height: Type.Optional(
			Type.Number({
				description: `Capture height in pixels. Default ${DEFAULT_HEIGHT}, clamped to ${MAX_DIMENSION}.`,
			}),
		),
		displayMode: Type.Optional(
			Type.String({
				description: 'Optional display mode name such as "Shaded", "Rendered", "Wireframe", or "Ghosted".',
			}),
		),
		transparentBackground: Type.Optional(
			Type.Boolean({
				description: "Use a transparent PNG background when Rhino supports it. Default false.",
			}),
		),
		restoreView: Type.Optional(
			Type.Boolean({
				description: "Restore the previous view after temporarily switching to another view. Default true.",
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		if (!modelSupportsImages(_ctx.model)) {
			return {
				content: [
					{
						type: "text" as const,
						text:
							`${describeModel(_ctx.model)} does not support image input, so Rhino viewport screenshots are unavailable. ` +
							"Tell the user they need to choose a multimodal model in Pi before viewport screenshots can be used. " +
							"Until then, work without visual capture using rh_query_objects, gh_get_canvas, gh_get_canvas_errors, or rh_run_script.",
					},
				],
				details: { allowed: false, reason: "model_not_multimodal" },
			};
		}

		if (!isRhinoVisualCaptureAllowed()) {
			return {
				content: [
					{
						type: "text" as const,
						text:
							"Rhino viewport screenshot capture was not allowed for this Pi session. " +
							"Work without visual capture; use rh_query_objects, gh_get_canvas, gh_get_canvas_errors, or rh_run_script for text/geometry context.",
					},
				],
				details: { allowed: false },
			};
		}

		const request = {
			type: "captureRhinoView",
			view: params.view?.trim() || "active",
			width: clampDimension(params.width, DEFAULT_WIDTH),
			height: clampDimension(params.height, DEFAULT_HEIGHT),
			displayMode: params.displayMode?.trim() || undefined,
			transparentBackground: params.transparentBackground === true,
			restoreView: params.restoreView !== false,
		};

		onUpdate?.({
			content: [{ type: "text", text: `Capturing Rhino viewport "${request.view}"...` }],
			details: {},
		});

		const res = await withRequester((req) =>
			req.request<CaptureRhinoViewResponse | { error?: string }>(request),
		);

		if ("error" in res && res.error) {
			return {
				content: [{ type: "text" as const, text: `FAILED: ${res.error}` }],
				details: { allowed: true },
			};
		}

		if (!("ok" in res) || !res.ok) {
			return {
				content: [{ type: "text" as const, text: `FAILED: ${"error" in res ? res.error : "Rhino capture failed"}` }],
				details: { allowed: true, response: res },
			};
		}

		return {
			content: [
				{ type: "text" as const, text: formatMetadata(res.metadata) },
				{
					type: "image" as const,
					data: res.imageBase64,
					mimeType: res.mediaType || "image/png",
				},
			],
			details: { allowed: true, metadata: res.metadata },
		};
	},
});
