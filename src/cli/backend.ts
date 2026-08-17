import type {
	BackendClient as OperationBackendClient,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
	MutationScope,
	RequestId,
} from "../core/contracts.js";
import { HopperCoreError, type HopperError } from "../core/errors.js";
import type { OperationContext } from "../core/operations.js";
import { createBackendClient, type BackendClient } from "../protocol/backend-client.js";
import type { ConnectionConfig } from "../infra/connection.js";
import {
	attachMutationPayloadSha256,
	createRequestId,
	createWireRequest,
	type BackendAction,
	type ExecuteActionsRequest,
	type QueryBackendRequest,
	type WireResponse,
} from "../protocol/wire.js";
import type { ArtifactRecord, ArtifactWriter } from "../core/contracts.js";

const QUERY_KINDS_WITH_RHINO = new Set([
	"runRhinoScript",
	"queryRhinoObjects",
	"captureRhinoView",
	"controlRhinoView",
	"getParamRhinoGeometry",
]);

/**
 * Adapts the versioned wire protocol client to the two-method backend surface
 * operations consume. Mutations fetch current backend/document identities
 * immediately before execution and send executeActions with payload digest
 * binding; reads ride the query envelope with optional identity verification.
 */
export type ExpectedIdentity = {
	backendId: string;
	grasshopperDocumentId: string;
	rhinoDocumentId: string | null;
};

export type MutationSendHooks = {
	/** Session-bound callers persist the exact wire request and journal the
	 * start event before any bytes go out. */
	onBeforeSend?: (request: ExecuteActionsRequest) => Promise<void>;
};

export class V1OperationBackend implements OperationBackendClient {
	constructor(
		readonly protocolClient: BackendClient,
		private readonly options: {
			expected?: ExpectedIdentity;
			expectedCanvasDigest?: string | null;
			hooks?: MutationSendHooks;
		} = {},
	) {}

	query<T extends JsonValue>(request: JsonObject, signal?: AbortSignal): Promise<T> {
		return this.queryInner<T>(request, signal);
	}

	private async queryInner<T extends JsonValue>(
		request: JsonObject,
		signal?: AbortSignal,
	): Promise<T> {
		const { type, ...input } = request;
		if (typeof type !== "string" || type.length === 0) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "Query requests require a legacy request type.",
				retryable: false,
			});
		}
		const wireRequest = createWireRequest("query", {
			...(this.options.expected ? {
				expectedBackendId: this.options.expected.backendId,
				expectedGrasshopperDocumentId: this.options.expected.grasshopperDocumentId,
				expectedRhinoDocumentId: this.options.expected.rhinoDocumentId,
			} : {}),
			query: { kind: type, input },
		}) as QueryBackendRequest;
		const response = await this.protocolClient.query<T>(wireRequest, signal);
		throwIfFailed(response);
		return response.data as T;
	}

	async executeActions(
		request: JsonObject,
		signal?: AbortSignal,
	): Promise<ExecuteActionsResponse> {
		const actions = (request.actions ?? []) as BackendAction[];
		if (!Array.isArray(actions) || actions.length === 0) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "executeActions requires a non-empty actions array.",
				retryable: false,
			});
		}
		const scope = ((request.scope as MutationScope | undefined) ?? inferScope(actions)) as
			| "viewport" | "grasshopper" | "rhino" | "mixed";
		let info: WireResponse;
		try {
			info = await this.protocolClient.getInfo(signal);
		} catch (error) {
			throw toCoreError(error);
		}
		const documents = info.documents;
		if (!documents?.grasshopper) {
			throw new HopperCoreError({
				code: "document_conflict",
				message: "No Grasshopper document is active on the backend.",
				retryable: false,
			});
		}
		let expectedBackendId: string;
		let expectedGrasshopperDocumentId: string;
		let expectedRhinoDocumentId: string | null;
		if (this.options.expected) {
			expectedBackendId = this.options.expected.backendId;
			expectedGrasshopperDocumentId = this.options.expected.grasshopperDocumentId;
			expectedRhinoDocumentId = this.options.expected.rhinoDocumentId;
		} else {
			expectedBackendId = info.backend.backendId;
			expectedGrasshopperDocumentId = documents.grasshopper.documentId;
			expectedRhinoDocumentId = documents.rhino?.documentId ?? null;
		}
		const body = {
			expectedBackendId,
			expectedGrasshopperDocumentId,
			expectedRhinoDocumentId,
		expectedCanvasDigest: this.options.expectedCanvasDigest ?? null,
			transactionName: "hopper call",
			scope,
			actions,
		};
		const wireRequest = attachMutationPayloadSha256(
			createWireRequest("executeActions", body, { requestId: createRequestId() }),
		) as ExecuteActionsRequest;

		await this.options.hooks?.onBeforeSend?.(wireRequest);

		try {
			const response = await this.protocolClient.executeActions(wireRequest, signal);
			return {
				outcome: response.outcome,
				data: response.data,
				error: response.error,
				canvasDigestAfter: response.data?.canvasDigestAfter ?? null,
			};
		} catch (error) {
			const coreError = toCoreError(error);
			if (coreError.hopperError.code === "outcome_unknown") {
				return {
					outcome: "unknown",
					data: null,
					error: coreError.hopperError,
					canvasDigestAfter: null,
				};
			}
			throw coreError;
		}
	}

	async close(): Promise<void> {
		await this.protocolClient.close();
	}
}

function inferScope(actions: readonly BackendAction[]): MutationScope {
	const kinds = new Set(actions.map((action) => action.kind));
	if (kinds.has("runRhinoScript") && kinds.size === 1) return "rhino";
	if (kinds.has("controlRhinoView") && kinds.size === 1) return "viewport";
	return "grasshopper";
}

function throwIfFailed(response: WireResponse<JsonValue>): void {
	if (response.outcome === "failed" || response.outcome === "partial") {
		throw new HopperCoreError(
			response.error ?? {
				code: "operation_failed",
				message: "The backend query failed.",
				retryable: false,
			},
		);
	}
}

function toCoreError(error: unknown): HopperCoreError {
	if (error instanceof HopperCoreError) return error;
	return new HopperCoreError({
		code: "backend_offline",
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	});
}

export type OperationContextDependencies = {
	connection: ConnectionConfig;
	artifacts: ArtifactWriter;
	requestId?: RequestId;
	now?: () => Date;
	protocolClient?: (connection: ConnectionConfig) => BackendClient;
};

/**
 * Creates an operation context bound to the versioned backend. The caller owns
 * the returned backend and must close it after execution.
 */
export function createV1OperationContext(
	options: OperationContextDependencies,
	args: {
		signal: AbortSignal;
		captureAllowed: boolean;
		session: OperationContext["session"];
		reportProgress: OperationContext["reportProgress"];
	},
): { context: OperationContext; backend: V1OperationBackend } {
	const clientFactory = options.protocolClient ?? ((connection: ConnectionConfig) => createBackendClient(connection));
	const backend = new V1OperationBackend(clientFactory(options.connection));
	const now = options.now ?? (() => new Date());
	return {
		backend,
		context: {
			signal: args.signal,
			requestId: options.requestId ?? createRequestId(now()),
			session: args.session,
			captureAllowed: args.captureAllowed,
			backend,
			artifacts: options.artifacts,
			reportProgress: args.reportProgress,
			now,
		},
	};
}

export { QUERY_KINDS_WITH_RHINO };
export type { HopperError, ArtifactRecord };
