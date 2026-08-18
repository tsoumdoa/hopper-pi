import { Type } from "@sinclair/typebox";
import { DocumentTargetSchema } from "./schemas.js";

const envelope = {
	timestamp: Type.Number(),
	target: DocumentTargetSchema,
};

export const AuthErrorResponseSchema = Type.Object({
	type: Type.Literal("auth.error"),
	timestamp: Type.Number(),
	error: Type.String(),
}, { additionalProperties: true });

export const PingBackendResponseSchema = Type.Object({
	type: Type.Literal("ping.response"),
	...envelope,
	backendStartedAt: Type.Number(),
}, { additionalProperties: true });

export const CanvasBackendResponseSchema = Type.Object({
	type: Type.Literal("getCurrentCanvas.response"),
	...envelope,
	docName: Type.String(),
	xml: Type.String(),
	selectedInstanceGuids: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

export const ComponentsBackendResponseSchema = Type.Object({
	type: Type.Literal("listAllComponents.response"),
	...envelope,
	components: Type.Array(Type.Object({
		name: Type.String(),
		typeGuid: Type.String(),
		pluginName: Type.String(),
		assemblyName: Type.String(),
		category: Type.String(),
		subcategory: Type.String(),
		description: Type.String(),
	}, { additionalProperties: true })),
}, { additionalProperties: true });

export const CanvasErrorsBackendResponseSchema = Type.Object({
	type: Type.Literal("getCanvasErrors.response"),
	...envelope,
	docName: Type.String(),
	errors: Type.Array(Type.Object({
		componentId: Type.String(),
		componentNickName: Type.String(),
		level: Type.String(),
		text: Type.String(),
	}, { additionalProperties: true })),
}, { additionalProperties: true });

export const ApplyGraphBackendResponseSchema = Type.Object({
	type: Type.Literal("applyGraph.response"),
	...envelope,
	ok: Type.Boolean(),
	rolledBack: Type.Boolean(),
	timedOut: Type.Boolean(),
	counts: Type.Object({
		components: Type.Integer(), widgets: Type.Integer(), scripts: Type.Integer(), wires: Type.Integer(), groups: Type.Integer(),
	}, { additionalProperties: false }),
	refs: Type.Record(Type.String(), Type.String()),
	structuralErrors: Type.Array(Type.Object({
		path: Type.String(), code: Type.String(), message: Type.String(), candidates: Type.Optional(Type.Array(Type.String())),
	}, { additionalProperties: true })),
	elapsedMs: Type.Number(),
}, { additionalProperties: true });

export const QueryRhinoObjectsBackendResponseSchema = Type.Object({
	type: Type.Literal("queryRhinoObjects.response"),
	...envelope,
	objects: Type.Array(Type.Object({
		objectId: Type.String(), name: Type.String(), layer: Type.String(), objectType: Type.String(),
	}, { additionalProperties: true })),
}, { additionalProperties: true });

export const RunRhinoScriptBackendResponseSchema = Type.Object({
	type: Type.Literal("runRhinoScript.response"),
	...envelope,
	ok: Type.Boolean(),
	output: Type.String(),
	error: Type.String(),
}, { additionalProperties: true });
