import { Type, type Static } from "@sinclair/typebox";
import { defineOperation } from "../../core/operations.js";
import { preservePiSchemaJson } from "../edit/shared.js";
import { failed, RhinoPointSchema, RhinoViewMetadataSchema, succeeded } from "./shared.js";

export const RhViewControlInputSchema = preservePiSchemaJson(Type.Object({
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
	standardView: Type.Optional(Type.Union([
		Type.Literal("top"), Type.Literal("bottom"), Type.Literal("front"), Type.Literal("back"),
		Type.Literal("left"), Type.Literal("right"), Type.Literal("perspective"),
		Type.Literal("twoPointPerspective"),
	], { description: "Standard Rhino projection for action=standardView." })),
	namedView: Type.Optional(Type.String({ description: "Existing named view to restore, or named view to save." })),
	cplaneName: Type.Optional(Type.String({ description: "Named construction plane. Omit to align to the active view CPlane." })),
	camera: Type.Optional(Type.Object({
		location: Type.Optional(RhinoPointSchema),
		target: Type.Optional(RhinoPointSchema),
		lensLength: Type.Optional(Type.Number({ description: "35mm lens length in millimeters." })),
		projection: Type.Optional(Type.Union([
			Type.Literal("parallel"), Type.Literal("perspective"), Type.Literal("twoPointPerspective"),
		])),
	})),
	zoom: Type.Optional(Type.Object({
		mode: Type.Optional(Type.Union([
			Type.Literal("extents"), Type.Literal("selected"), Type.Literal("boundingBox"),
		])),
		min: Type.Optional(RhinoPointSchema),
		max: Type.Optional(RhinoPointSchema),
	})),
}));

export const RhViewControlOutputSchema = Type.Object({
	message: Type.String(),
	metadata: Type.Union([RhinoViewMetadataSchema, Type.Null()]),
});

export type RhViewControlInput = Static<typeof RhViewControlInputSchema>;
export type RhViewControlData = Static<typeof RhViewControlOutputSchema>;

const VALID_STANDARD_VIEWS = new Set([
	"top", "bottom", "front", "back", "left", "right", "perspective", "twoPointPerspective",
]);

function validate(input: RhViewControlInput): string | null {
	switch (input.action) {
		case "setActiveView": return input.viewName?.trim() ? null : "setActiveView requires viewName";
		case "standardView":
			if (!input.standardView?.trim()) return "standardView requires standardView";
			return VALID_STANDARD_VIEWS.has(input.standardView) ? null : `unsupported standardView "${input.standardView}"`;
		case "namedView": return input.namedView?.trim() ? null : "namedView requires namedView";
		case "cplaneView": return null;
		case "camera":
			if (!input.camera) return "camera requires camera settings";
			if (
				input.camera.location === undefined && input.camera.target === undefined &&
				input.camera.lensLength === undefined && input.camera.projection === undefined
			) return "camera requires at least one of location, target, lensLength, or projection";
			if (input.camera.lensLength !== undefined && input.camera.lensLength <= 0) {
				return "camera.lensLength must be a positive number";
			}
			return null;
		case "zoom":
			if (!input.zoom?.mode) return "zoom requires zoom.mode";
			if (input.zoom.mode === "boundingBox" && (!input.zoom.min || !input.zoom.max)) {
				return "zoom mode boundingBox requires finite min and max points";
			}
			return null;
		case "saveNamedView": return input.namedView?.trim() ? null : "saveNamedView requires namedView";
	}
}

type ControlResponse = {
	ok?: boolean;
	error?: string | null;
	message?: string;
	metadata?: RhViewControlData["metadata"];
};

export const rhViewControlOperation = defineOperation<RhViewControlInput, RhViewControlData>({
	name: "rh_view_control",
	version: 1,
	description: "Change the active Rhino viewport, projection, camera, construction plane, or zoom.",
	group: "rhino",
	possibleScopes: ["viewport"],
	inputSchema: RhViewControlInputSchema,
	outputSchema: RhViewControlOutputSchema,
	classifyScope: () => "viewport",
	summarizeInput: (input) => input,
	async execute(input, context) {
		const validationError = validate(input);
		if (validationError) return failed("invalid_input", validationError);
		context.reportProgress({ phase: "rhino_view", message: `Updating Rhino view (${input.action}).` });
		const response = await context.backend.query<ControlResponse>({
			type: "controlRhinoView",
			...input,
		}, context.signal);
		if (!response.ok) return failed("operation_failed", response.error || "Rhino view update failed.");
		const message = response.message || "Rhino view updated.";
		return succeeded(message, { message, metadata: response.metadata ?? null });
	},
});
