import { Type } from "typebox";
import { defineHopperTool as defineTool } from "../core/tool-contract.js";
import { withRequester } from "../infra/request-helpers.js";
import type { ControlRhinoViewResponse } from "../types/messages.js";
import { errorResult } from "../core/tool-error.js";

type RhinoPointInput = { x?: number; y?: number; z?: number };

export type RhViewControlParams = {
	action: "setActiveView" | "standardView" | "namedView" | "cplaneView" | "camera" | "zoom" | "saveNamedView";
	viewName?: string;
	standardView?: string;
	namedView?: string;
	cplaneName?: string;
	camera?: {
		location?: RhinoPointInput;
		target?: RhinoPointInput;
		lensLength?: number;
		projection?: "parallel" | "perspective" | "twoPointPerspective";
	};
	zoom?: {
		mode?: "extents" | "selected" | "boundingBox";
		min?: RhinoPointInput;
		max?: RhinoPointInput;
	};
};

const VALID_STANDARD_VIEWS = new Set([
	"top",
	"bottom",
	"front",
	"back",
	"left",
	"right",
	"perspective",
	"twoPointPerspective",
]);

function isPoint(value: RhinoPointInput | undefined): boolean {
	return (
		!!value
		&& typeof value.x === "number"
		&& Number.isFinite(value.x)
		&& typeof value.y === "number"
		&& Number.isFinite(value.y)
		&& typeof value.z === "number"
		&& Number.isFinite(value.z)
	);
}

export function validateRhViewControlParams(params: RhViewControlParams): string | null {
	if (!params || typeof params !== "object") return "invalid params";

	switch (params.action) {
		case "setActiveView":
			return params.viewName?.trim() ? null : "setActiveView requires viewName";
		case "standardView": {
			const view = params.standardView?.trim();
			if (!view) return "standardView requires standardView";
			return VALID_STANDARD_VIEWS.has(view) ? null : `unsupported standardView "${view}"`;
		}
		case "namedView":
			return params.namedView?.trim() ? null : "namedView requires namedView";
		case "cplaneView":
			return null;
		case "camera":
			if (!params.camera) return "camera requires camera settings";
			if (params.camera.location !== undefined && !isPoint(params.camera.location)) return "camera.location must include finite x, y, z";
			if (params.camera.target !== undefined && !isPoint(params.camera.target)) return "camera.target must include finite x, y, z";
			if (params.camera.location === undefined && params.camera.target === undefined && params.camera.lensLength === undefined && params.camera.projection === undefined) {
				return "camera requires at least one of location, target, lensLength, or projection";
			}
			if (params.camera.lensLength !== undefined && (!Number.isFinite(params.camera.lensLength) || params.camera.lensLength <= 0)) {
				return "camera.lensLength must be a positive number";
			}
			return null;
		case "zoom":
			if (!params.zoom?.mode) return "zoom requires zoom.mode";
			if (params.zoom.mode === "boundingBox" && (!isPoint(params.zoom.min) || !isPoint(params.zoom.max))) {
				return "zoom mode boundingBox requires finite min and max points";
			}
			return null;
		case "saveNamedView":
			return params.namedView?.trim() ? null : "saveNamedView requires namedView";
		default:
			return `unsupported action "${(params as { action?: string }).action ?? ""}"`;
	}
}

function responseText(res: ControlRhinoViewResponse): string {
	const lines = [res.message || (res.ok ? "Rhino view updated." : "Rhino view update failed.")];
	if (res.metadata) {
		lines.push(
			`View: ${res.metadata.viewName}`,
			`Projection: ${res.metadata.projection}`,
			`Camera target: (${res.metadata.cameraTarget.x.toFixed(3)}, ${res.metadata.cameraTarget.y.toFixed(3)}, ${res.metadata.cameraTarget.z.toFixed(3)})`,
		);
	}
	return lines.join("\n");
}

const PointSchema = Type.Object({
	x: Type.Number({ description: "X coordinate" }),
	y: Type.Number({ description: "Y coordinate" }),
	z: Type.Number({ description: "Z coordinate" }),
});

export const rhViewControlTool = defineTool({
	name: "rh_view_control",
	label: "Control Rhino View",
	description:
		"Change the active Rhino viewport or camera: setActiveView, standardView, namedView, cplaneView, camera, zoom, or saveNamedView. " +
		"Prefer over rh_run_script for normal view changes. saveNamedView only when the user explicitly asked to create/update a named view. " +
		"One-off screenshots: prefer rh_capture_view.view (temporary switch + restore).",
	parameters: Type.Object({
		action: Type.Union([
			Type.Literal("setActiveView"),
			Type.Literal("standardView"),
			Type.Literal("namedView"),
			Type.Literal("cplaneView"),
			Type.Literal("camera"),
			Type.Literal("zoom"),
			Type.Literal("saveNamedView"),
		]),
		viewName: Type.Optional(Type.String({ description: "Viewport name/id for setActiveView." })),
		standardView: Type.Optional(
			Type.Union([
				Type.Literal("top"),
				Type.Literal("bottom"),
				Type.Literal("front"),
				Type.Literal("back"),
				Type.Literal("left"),
				Type.Literal("right"),
				Type.Literal("perspective"),
				Type.Literal("twoPointPerspective"),
			], {
				description: "Standard Rhino projection for action=standardView.",
			}),
		),
		namedView: Type.Optional(Type.String({ description: "Existing named view to restore, or named view to save." })),
		cplaneName: Type.Optional(Type.String({ description: "Named construction plane. Omit to align to the active view CPlane." })),
		camera: Type.Optional(
			Type.Object({
				location: Type.Optional(PointSchema),
				target: Type.Optional(PointSchema),
				lensLength: Type.Optional(Type.Number({ description: "35mm lens length in millimeters." })),
				projection: Type.Optional(
					Type.Union([
						Type.Literal("parallel"),
						Type.Literal("perspective"),
						Type.Literal("twoPointPerspective"),
					]),
				),
			}),
		),
		zoom: Type.Optional(
			Type.Object({
				mode: Type.Optional(
					Type.Union([
						Type.Literal("extents"),
						Type.Literal("selected"),
						Type.Literal("boundingBox"),
					]),
				),
				min: Type.Optional(PointSchema),
				max: Type.Optional(PointSchema),
			}),
		),
	}),

	async execute(_toolCallId, params, signal, onUpdate) {
		const validationError = validateRhViewControlParams(params as RhViewControlParams);
		if (validationError) {
			return errorResult("invalid_input", `Rhino view input is invalid: ${validationError}`, {
				details: { validationError },
			});
		}

		onUpdate?.({
			content: [{ type: "text", text: `Updating Rhino view (${params.action})...` }],
			details: {},
		});

		const res = await withRequester(
			(req) => req.request<ControlRhinoViewResponse | { error?: string }>({
				type: "controlRhinoView",
				...params,
			}),
			{ signal },
		);

		if ("error" in res && res.error) {
			return errorResult("backend_error", `Rhino view update failed: ${res.error}`);
		}

		if (!("ok" in res) || !res.ok) {
			return errorResult(
				"backend_error",
				`Rhino view update failed: ${"error" in res ? res.error : "unknown backend failure"}`,
				{ details: { response: res } },
			);
		}

		return {
			content: [{ type: "text" as const, text: responseText(res) }],
			details: { metadata: res.metadata },
		};
	},
});
