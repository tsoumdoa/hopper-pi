import { createHash, randomBytes } from "node:crypto";
import type {
	BackendId,
	GrasshopperDocumentId,
	JsonObject,
	JsonValue,
	MutationScope,
	OperationOutcome,
	RequestId,
	RhinoDocumentId,
} from "../core/contracts.js";
import type { HopperError } from "../core/errors.js";
import type { CommandAction, CommandMap, RhinoObjectQueryParams } from "../types/commands.js";
import type { NormalizedApplyGraphRequest } from "../types/gh-apply-graph.js";

export const HOPPER_PROTOCOL_VERSION = 1 as const;

export type BackendIdentity = {
	backendId: BackendId;
	backendStartedAt: string;
	pluginVersion: string;
	protocolVersion: 1;
};

export type GrasshopperDocumentIdentity = {
	documentId: GrasshopperDocumentId;
	displayName: string;
	path: string | null;
};

export type RhinoDocumentIdentity = {
	documentId: RhinoDocumentId;
	runtimeSerialNumber: number;
	displayName: string;
	path: string | null;
};

export type BackendDocuments = {
	grasshopper: GrasshopperDocumentIdentity;
	rhino: RhinoDocumentIdentity | null;
};

export type WireRequest<T extends string, B extends JsonObject> = {
	protocolVersion: 1;
	type: T;
	requestId: RequestId;
	issuedAt: string;
	body: B;
	token?: string;
};

export type WireResponse<T extends JsonValue = JsonValue> = {
	protocolVersion: 1;
	type: string;
	requestId: RequestId;
	backend: BackendIdentity;
	documents: BackendDocuments | null;
	outcome: OperationOutcome;
	startedAt: string | null;
	completedAt: string | null;
	data: T | null;
	error: HopperError | null;
};

function canonicalJson(value: unknown, path = "$"): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item, index) => canonicalJson(item, `${path}/${index}`)).join(",")}]`;
	}
	if (!value || typeof value !== "object") {
		throw new TypeError(`Non-JSON value at ${path}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`Non-JSON object at ${path}`);
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) =>
		`${JSON.stringify(key)}:${canonicalJson(record[key], `${path}/${key}`)}`,
	).join(",")}}`;
}

export function canonicalJsonSha256(value: JsonValue): string {
	return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function redactWireRequestForLog(
	request: WireRequest<string, JsonObject>,
): JsonObject {
	return {
		protocolVersion: request.protocolVersion,
		type: request.type,
		requestId: request.requestId,
		issuedAt: request.issuedAt,
		body: {
			redacted: true,
			sha256: canonicalJsonSha256(request.body),
		},
		...(typeof (request as { payloadSha256?: unknown }).payloadSha256 === "string"
			? { payloadSha256: (request as unknown as { payloadSha256: string }).payloadSha256 }
			: {}),
	};
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: bigint, length: number): string {
	let encoded = "";
	for (let index = 0; index < length; index++) {
		encoded = ULID_ALPHABET[Number(value & 31n)] + encoded;
		value >>= 5n;
	}
	return encoded;
}

export function createRequestId(
	now: number | Date = Date.now(),
	random: Uint8Array = randomBytes(10),
): RequestId {
	const timestamp = now instanceof Date ? now.getTime() : now;
	if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
		throw new RangeError("Request ID timestamp must fit in 48 bits.");
	}
	if (random.byteLength !== 10) throw new RangeError("Request ID randomness must contain 10 bytes.");
	let randomness = 0n;
	for (const byte of random) randomness = (randomness << 8n) | BigInt(byte);
	return `req_${encodeBase32(BigInt(timestamp), 10)}${encodeBase32(randomness, 16)}`;
}

export type LegacyControlAction =
	| "getScriptCode"
	| "listScriptParams"
	| "beginAgentTransaction"
	| "commitAgentTransaction"
	| "cancelAgentTransaction"
	| "beginRhinoAgentTransaction"
	| "commitRhinoAgentTransaction"
	| "cancelRhinoAgentTransaction";

export type MutationCommandAction = Exclude<CommandAction, LegacyControlAction>;
export type MutationCommandMap = Pick<CommandMap, MutationCommandAction>;

export type LowLevelCommand<A extends MutationCommandAction = MutationCommandAction> = {
	action: A;
	params: MutationCommandMap[A];
};

export type RhRunScriptInput = {
	mode: "python" | "csharp";
	source: string;
	echo?: boolean;
};

export type BackendAction =
	| { kind: "command"; command: LowLevelCommand }
	| { kind: "applyGraph"; input: NormalizedApplyGraphRequest }
	| { kind: "runRhinoScript"; input: RhRunScriptInput }
	| { kind: "controlRhinoView"; input: JsonObject };

export type ExecuteActionsBody = {
	expectedBackendId: BackendId;
	expectedGrasshopperDocumentId: GrasshopperDocumentId;
	expectedRhinoDocumentId: RhinoDocumentId | null;
	expectedCanvasDigest: string | null;
	transactionName: string;
	scope: Exclude<MutationScope, "none">;
	actions: BackendAction[];
};

export type ExecuteActionsRequest = WireRequest<"executeActions", ExecuteActionsBody> & {
	payloadSha256: string;
};

export type ActionResult = {
	index: number;
	kind: BackendAction["kind"];
	action?: MutationCommandAction;
	outcome: "succeeded" | "failed" | "skipped" | "unknown";
	message: string;
	data: JsonValue | null;
	error: HopperError | null;
	elapsedMs: number;
};

export type TransactionResult = {
	outcome: "committed" | "rolled_back" | "unchanged" | "partial" | "unknown";
	grasshopperUndoRecorded: boolean;
	rhinoUndoRecorded: boolean;
	grasshopperRolledBack: boolean;
	rhinoRolledBack: boolean;
	limitations: string[];
};

export type ExecuteActionsData = {
	payloadSha256: string;
	actions: ActionResult[];
	transaction: TransactionResult;
	canvasDigestBefore: string | null;
	canvasDigestAfter: string | null;
	elapsedMs: number;
};

export type ExecuteActionsResponse = WireResponse<ExecuteActionsData>;

export type BackendQuery =
	| { kind: "getCurrentCanvas"; input: { selectionOnly?: boolean } }
	| { kind: "getCanvasErrors"; input: Record<string, never> }
	| { kind: "listAllComponents"; input: Record<string, never> }
	| { kind: "listScriptParams"; input: { targetId: string } }
	| { kind: "getScriptCode"; input: { targetId: string } }
	| { kind: "queryRhinoObjects"; input: RhinoObjectQueryParams }
	| { kind: "getParamRhinoGeometry"; input: { targetId: string } }
	| { kind: "captureRhinoView"; input: JsonObject };

export type QueryBackendRequest = WireRequest<"query", {
	expectedBackendId?: BackendId;
	expectedGrasshopperDocumentId?: GrasshopperDocumentId;
	expectedRhinoDocumentId?: RhinoDocumentId;
	query: BackendQuery;
}>;

export type QueryBackendResponse<T extends JsonValue = JsonValue> = WireResponse<T>;

export type GetBackendInfoRequest = WireRequest<"getBackendInfo", Record<string, never>>;
export type GetBackendInfoResponse = WireResponse<{
	capabilities: string[];
	maxRequestBytes: number;
	maxCheckpointBytes: number;
	deduplicationWindowMs: number;
}>;

export type GetRequestStatusRequest = WireRequest<"getRequestStatus", {
	targetRequestId: RequestId;
	payloadSha256: string;
}>;

export type RequestStatusData = {
	targetRequestId: RequestId;
	state: "running" | "succeeded" | "failed" | "partial" | "unknown" | "not_found" | "expired";
	cachedResponse: ExecuteActionsResponse | null;
};

export type GetRequestStatusResponse = WireResponse<RequestStatusData>;

export type CanvasCheckpointEnvelope = {
	schemaVersion: 1;
	checkpointId: string;
	backendId: BackendId;
	grasshopperDocumentId: GrasshopperDocumentId;
	capturedAt: string;
	encoding: "base64";
	compression: "none";
	bytes: string;
	byteLength: number;
	binarySha256: string;
	canvasDigest: string;
};

export type CaptureCheckpointRequest = WireRequest<"captureCheckpoint", {
	expectedBackendId: BackendId;
	expectedGrasshopperDocumentId: GrasshopperDocumentId;
}>;
export type CaptureCheckpointResponse = WireResponse<CanvasCheckpointEnvelope>;

export type RestoreCheckpointRequest = WireRequest<"restoreCheckpoint", {
	expectedBackendId: BackendId;
	expectedGrasshopperDocumentId: GrasshopperDocumentId;
	expectedLiveCanvasDigest: string;
	checkpoint: CanvasCheckpointEnvelope;
	transactionName: string;
}> & { payloadSha256: string };

export type RestoreCheckpointData = {
	restoredCheckpointId: string;
	previousCanvasDigest: string;
	currentCanvasDigest: string;
	grasshopperUndoRecorded: boolean;
};
export type RestoreCheckpointResponse = WireResponse<RestoreCheckpointData>;

export function mutationPayloadSha256(body: JsonObject): string {
	return canonicalJsonSha256(body);
}

export function attachMutationPayloadSha256<
	T extends WireRequest<string, JsonObject>,
>(request: T): T & { payloadSha256: string } {
	return { ...request, payloadSha256: mutationPayloadSha256(request.body) };
}

export function createWireRequest<T extends string, B extends JsonObject>(
	type: T,
	body: B,
	options: { requestId?: RequestId; issuedAt?: Date } = {},
): WireRequest<T, B> {
	return {
		protocolVersion: HOPPER_PROTOCOL_VERSION,
		type,
		requestId: options.requestId ?? createRequestId(options.issuedAt),
		issuedAt: (options.issuedAt ?? new Date()).toISOString(),
		body,
	};
}

