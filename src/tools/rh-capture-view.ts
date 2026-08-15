import { Type } from "typebox";
import { defineHopperTool as defineTool } from "../core/tool-contract.js";
import { errorResult } from "../core/tool-error.js";
import { withRequester } from "../infra/request-helpers.js";
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
		"Capture a Rhino viewport screenshot as PNG visual context when the selected model supports images and session consent (or HOPPER_RHINO_CAPTURE_CONSENT=allow) permits it. " +
		"Use view for a one-off active, standard, or named-view capture; restoreView defaults to true. Use rh_view_control first only for a custom camera/CPlane setup or an intentionally persistent view change.",
	promptSnippet: "Capture a consent-gated Rhino viewport screenshot for visual QA",
	promptGuidelines: [
		"Use rh_capture_view only when pixels materially help visual QA and Rhino screenshot consent is allowed.",
		"If rh_capture_view is unavailable or denied, continue with text and geometry tools instead of blocking the task.",
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

	async executeCore(params, ctx) {
		if (ctx.supportsImages === false) {
			return errorResult(
				"unsupported_client",
				"The current client cannot receive Rhino viewport images. Continue with text and geometry tools.",
				{ details: { allowed: false, reason: "images_not_supported" } },
			);
		}

		if (ctx.captureAllowed !== true) {
			return errorResult(
				"consent_required",
				"Rhino viewport capture requires explicit approval for this call.",
				{ details: { allowed: false } },
			);
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

		ctx.reportProgress?.({
			content: [{ type: "text", text: `Capturing Rhino viewport "${request.view}"...` }],
			details: {},
		});

		const res = await withRequester(
			(req) => req.request<CaptureRhinoViewResponse | { error?: string }>(request),
			{ signal: ctx.signal },
		);

		if ("error" in res && res.error) {
			return errorResult("backend_error", `Rhino capture failed: ${res.error}`, {
				details: { allowed: true },
			});
		}

		if (!("ok" in res) || !res.ok) {
			return errorResult(
				"backend_error",
				`Rhino capture failed: ${"error" in res ? res.error : "unknown backend failure"}`,
				{ details: { allowed: true, response: res } },
			);
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
