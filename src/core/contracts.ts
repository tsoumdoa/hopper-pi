import type { TSchema } from "@sinclair/typebox";
import type { HopperError, HopperWarning } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema<T extends JsonValue = JsonValue> = TSchema & { static: T };

export type SessionId = `hs_${string}`;
export type RequestId = `req_${string}`;
export type EditId = `edit_${string}`;
export type BackendId = `be_${string}`;
export type GrasshopperDocumentId = `ghd_${string}`;
export type RhinoDocumentId = `rhd_${string}`;

export type CanonicalCanvasObject = {
	id: string;
	typeId: string;
	kind: string;
	name: string;
	x: number;
	y: number;
	properties: JsonObject;
};

export type CanonicalWire = {
	fromObjectId: string;
	fromPort: string;
	toObjectId: string;
	toPort: string;
};

export type CanonicalGroup = {
	id: string;
	name: string;
	memberIds: string[];
	properties: JsonObject;
};

export type CanonicalCanvas = {
	objects: CanonicalCanvasObject[];
	wires: CanonicalWire[];
	groups: CanonicalGroup[];
};

export type CanvasObjectChange = { id: string; object: CanonicalCanvasObject };
export type CanvasMoveChange = {
	id: string;
	before: { x: number; y: number };
	after: { x: number; y: number };
};
export type CanvasRenameChange = { id: string; before: string; after: string };
export type CanvasPropertyChange = { id: string; before: JsonObject; after: JsonObject };
export type CanvasGroupChange = {
	id: string;
	before: CanonicalGroup | null;
	after: CanonicalGroup | null;
};

export type CanvasDiff = {
	beforeDigest: string;
	afterDigest: string;
	added: CanvasObjectChange[];
	removed: CanvasObjectChange[];
	moved: CanvasMoveChange[];
	renamed: CanvasRenameChange[];
	propertiesChanged: CanvasPropertyChange[];
	wiresAdded: CanonicalWire[];
	wiresRemoved: CanonicalWire[];
	groupsChanged: CanvasGroupChange[];
};

export type MutationScope = "none" | "viewport" | "grasshopper" | "rhino" | "mixed";
export type OperationOutcome =
	| "succeeded"
	| "failed"
	| "partial"
	| "unknown"
	| "in_progress";

export type ArtifactRecord = {
	artifactId: string;
	kind: "viewport_capture" | "checkpoint" | "diagnostic";
	path: string;
	mediaType: string;
	byteLength: number;
	sha256: string;
};

export type OperationResult<T extends JsonValue> = {
	outcome: OperationOutcome;
	message: string;
	data: T | null;
	/** Mutation metadata used by the session journal. This is not part of the
	 * operation's public data schema. */
	execution?: {
		canvasDigestAfter: string | null;
	};
	warnings: HopperWarning[];
	artifacts: ArtifactRecord[];
	error: HopperError | null;
};

export type ProgressEvent = {
	phase: string;
	message: string;
	completed?: number;
	total?: number;
};

export type SessionBinding = {
	sessionId: SessionId;
	backendId: BackendId;
	grasshopperDocumentId: GrasshopperDocumentId;
	rhinoDocumentId: RhinoDocumentId | null;
};

/**
 * Forward contracts used by the operation core. PR 2 replaces these shapes with
 * the versioned wire protocol without changing OperationContext.
 */
export type BackendAction = {
	kind: "command" | "applyGraph" | "runRhinoScript" | "controlRhinoView";
	[key: string]: JsonValue;
};

export type ExecuteActionsResponse = {
	outcome: OperationOutcome;
	data: JsonValue | null;
	error: HopperError | null;
	canvasDigestAfter?: string | null;
};

export interface BackendClient {
	query<T extends JsonValue>(
		request: JsonObject,
		signal?: AbortSignal,
	): Promise<T>;
	executeActions(
		request: JsonObject,
		signal?: AbortSignal,
	): Promise<ExecuteActionsResponse>;
}

export interface ArtifactWriter {
	write(options: {
		kind: ArtifactRecord["kind"];
		mediaType: string;
		bytes: Uint8Array;
		suggestedName?: string;
	}): Promise<ArtifactRecord>;
}
