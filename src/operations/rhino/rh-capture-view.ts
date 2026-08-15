import { Type, type Static } from "@sinclair/typebox";
import { defineOperation } from "../../core/operations.js";
import { preservePiSchemaJson } from "../edit/shared.js";
import { failed, RhinoViewMetadataSchema, succeeded } from "./shared.js";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MAX_DIMENSION = 2000;

export const RhCaptureViewInputSchema = preservePiSchemaJson(Type.Object({
	view: Type.Optional(Type.String({
		description:
			'Viewport to capture: "active" (default), a standard view (top/front/right/perspective/etc.), or an existing named view name.',
	})),
	width: Type.Optional(Type.Number({
		description: `Capture width in pixels. Default ${DEFAULT_WIDTH}, clamped to ${MAX_DIMENSION}.`,
	})),
	height: Type.Optional(Type.Number({
		description: `Capture height in pixels. Default ${DEFAULT_HEIGHT}, clamped to ${MAX_DIMENSION}.`,
	})),
	displayMode: Type.Optional(Type.String({
		description: 'Optional display mode name such as "Shaded", "Rendered", "Wireframe", or "Ghosted".',
	})),
	transparentBackground: Type.Optional(Type.Boolean({
		description: "Use a transparent PNG background when Rhino supports it. Default false.",
	})),
	restoreView: Type.Optional(Type.Boolean({
		description: "Restore the previous view after temporarily switching to another view. Default true.",
	})),
}));

const ArtifactRecordSchema = Type.Object({
	artifactId: Type.String(),
	kind: Type.Union([Type.Literal("viewport_capture"), Type.Literal("checkpoint"), Type.Literal("diagnostic")]),
	path: Type.String(),
	mediaType: Type.String(),
	byteLength: Type.Integer({ minimum: 0 }),
	sha256: Type.String(),
});

export const RhCaptureViewOutputSchema = Type.Object({
	artifact: ArtifactRecordSchema,
	metadata: Type.Union([RhinoViewMetadataSchema, Type.Null()]),
});

export type RhCaptureViewInput = Static<typeof RhCaptureViewInputSchema>;
export type RhCaptureViewData = Static<typeof RhCaptureViewOutputSchema>;

function clampDimension(value: number | undefined, fallback: number): number {
	return Math.min(Math.max(Math.round(value ?? fallback), 64), MAX_DIMENSION);
}

type CaptureResponse = {
	ok?: boolean;
	imageBase64?: string;
	mediaType?: string;
	error?: string | null;
	metadata?: RhCaptureViewData["metadata"];
};

export const rhCaptureViewOperation = defineOperation<RhCaptureViewInput, RhCaptureViewData>({
	name: "rh_capture_view",
	version: 1,
	description: "Capture a permission-gated Rhino viewport image as an artifact.",
	group: "rhino",
	possibleScopes: ["none"],
	inputSchema: RhCaptureViewInputSchema,
	outputSchema: RhCaptureViewOutputSchema,
	classifyScope: () => "none",
	summarizeInput: (input) => ({
		...(input.view !== undefined ? { view: input.view } : {}),
		...(input.width !== undefined ? { width: input.width } : {}),
		...(input.height !== undefined ? { height: input.height } : {}),
		...(input.displayMode !== undefined ? { displayMode: input.displayMode } : {}),
		...(input.transparentBackground !== undefined ? { transparentBackground: input.transparentBackground } : {}),
		...(input.restoreView !== undefined ? { restoreView: input.restoreView } : {}),
	}),
	async execute(input, context) {
		if (context.captureAllowed !== true) {
			return failed("operation_failed", "Rhino viewport capture is not allowed for this call.", {
				details: { captureAllowed: false },
			});
		}
		const request = {
			type: "captureRhinoView",
			view: input.view?.trim() || "active",
			width: clampDimension(input.width, DEFAULT_WIDTH),
			height: clampDimension(input.height, DEFAULT_HEIGHT),
			...(input.displayMode?.trim() ? { displayMode: input.displayMode.trim() } : {}),
			transparentBackground: input.transparentBackground === true,
			restoreView: input.restoreView !== false,
		};
		context.reportProgress({ phase: "rhino_capture", message: `Capturing Rhino viewport "${request.view}".` });
		const response = await context.backend.query<CaptureResponse>(request, context.signal);
		if (!response.ok || !response.imageBase64) {
			return failed("operation_failed", response.error || "Rhino capture failed.");
		}
		const mediaType = response.mediaType || "image/png";
		const contents = Buffer.from(response.imageBase64, "base64");
		if (contents.byteLength === 0) return failed("operation_failed", "Rhino capture returned an empty image.");
		const artifact = await context.artifacts.write({
			kind: "viewport_capture",
			mediaType,
			bytes: contents,
			suggestedName: "rhino-view.png",
		});
		return succeeded("Captured Rhino viewport.", {
			artifact,
			metadata: response.metadata ?? null,
		}, [artifact]);
	},
});
