import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue, OperationResult } from "../../core/contracts.js";
import type { HopperErrorCode } from "../../core/errors.js";

export const RhinoPointSchema = Type.Object({
	x: Type.Number({ description: "X coordinate" }),
	y: Type.Number({ description: "Y coordinate" }),
	z: Type.Number({ description: "Z coordinate" }),
});

export const RhinoViewMetadataSchema = Type.Object({
	viewName: Type.String(),
	viewportId: Type.String(),
	projection: Type.String(),
	cameraLocation: RhinoPointSchema,
	cameraTarget: RhinoPointSchema,
	cameraDirection: RhinoPointSchema,
	cameraUp: RhinoPointSchema,
	lensLength: Type.Number(),
	cplaneName: Type.String(),
	cplaneOrigin: RhinoPointSchema,
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
});

export type RhinoViewMetadata = Static<typeof RhinoViewMetadataSchema>;

export function succeeded<T extends JsonValue>(
	message: string,
	data: T,
	artifacts: OperationResult<T>["artifacts"] = [],
): OperationResult<T> {
	return {
		outcome: "succeeded",
		message,
		data,
		warnings: [],
		artifacts,
		error: null,
	};
}

export function failed<T extends JsonValue>(
	code: HopperErrorCode,
	message: string,
	options: {
		outcome?: "failed" | "partial" | "unknown";
		data?: T | null;
		retryable?: boolean;
		details?: JsonObject;
	} = {},
): OperationResult<T> {
	return {
		outcome: options.outcome ?? "failed",
		message,
		data: options.data ?? null,
		warnings: [],
		artifacts: [],
		error: {
			code,
			message,
			retryable: options.retryable ?? false,
			...(options.details ? { details: options.details } : {}),
		},
	};
}

