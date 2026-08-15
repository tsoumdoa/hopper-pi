import type { JsonObject, JsonValue, RequestId } from "../core/contracts.js";
import { HopperCoreError } from "../core/errors.js";
import type { ConnectionConfig } from "../infra/connection.js";
import { Requester, type RequestOptions } from "../infra/requester.js";
import {
	HOPPER_PROTOCOL_VERSION,
	createWireRequest,
	mutationPayloadSha256,
	type CaptureCheckpointRequest,
	type CaptureCheckpointResponse,
	type ExecuteActionsRequest,
	type ExecuteActionsResponse,
	type GetBackendInfoResponse,
	type GetRequestStatusResponse,
	type QueryBackendRequest,
	type QueryBackendResponse,
	type RestoreCheckpointRequest,
	type RestoreCheckpointResponse,
	type WireRequest,
	type WireResponse,
} from "./wire.js";

export interface BackendClient {
	getInfo(signal?: AbortSignal): Promise<GetBackendInfoResponse>;
	query<T extends JsonValue>(
		request: QueryBackendRequest,
		signal?: AbortSignal,
	): Promise<QueryBackendResponse<T>>;
	getRequestStatus(
		requestId: RequestId,
		payloadSha256: string,
		signal?: AbortSignal,
	): Promise<GetRequestStatusResponse>;
	executeActions(
		request: ExecuteActionsRequest,
		signal?: AbortSignal,
	): Promise<ExecuteActionsResponse>;
	captureCheckpoint(
		request: CaptureCheckpointRequest,
		signal?: AbortSignal,
	): Promise<CaptureCheckpointResponse>;
	restoreCheckpoint(
		request: RestoreCheckpointRequest,
		signal?: AbortSignal,
	): Promise<RestoreCheckpointResponse>;
	close(): Promise<void>;
}

export type ProtocolRequester = {
	connect(options?: { refresh?: boolean }): Promise<void>;
	request<T extends JsonValue>(
		request: WireRequest<string, JsonObject>,
		options: RequestOptions,
	): Promise<WireResponse<T>>;
	close(): Promise<void>;
};

export type BackendClientOptions = {
	receiveTimeoutMs?: number;
	requester?: ProtocolRequester;
	now?: () => Date;
};

class V1BackendClient implements BackendClient {
	private connected = false;
	private readonly receiveTimeoutMs: number;
	private readonly now: () => Date;

	constructor(
		private readonly requester: ProtocolRequester,
		options: BackendClientOptions,
	) {
		this.receiveTimeoutMs = options.receiveTimeoutMs ?? 30_000;
		this.now = options.now ?? (() => new Date());
	}

	async getInfo(signal?: AbortSignal): Promise<GetBackendInfoResponse> {
		return this.send(createWireRequest("getBackendInfo", {}, { issuedAt: this.now() }), signal);
	}

	async query<T extends JsonValue>(
		request: QueryBackendRequest,
		signal?: AbortSignal,
	): Promise<QueryBackendResponse<T>> {
		return this.send<T>(request, signal);
	}

	async getRequestStatus(
		requestId: RequestId,
		payloadSha256: string,
		signal?: AbortSignal,
	): Promise<GetRequestStatusResponse> {
		return this.send(createWireRequest("getRequestStatus", {
			targetRequestId: requestId,
			payloadSha256,
		}, { issuedAt: this.now() }), signal);
	}

	async executeActions(
		request: ExecuteActionsRequest,
		signal?: AbortSignal,
	): Promise<ExecuteActionsResponse> {
		assertMutationDigest(request);
		return this.send(request, signal);
	}

	async captureCheckpoint(
		request: CaptureCheckpointRequest,
		signal?: AbortSignal,
	): Promise<CaptureCheckpointResponse> {
		return this.send(request, signal);
	}

	async restoreCheckpoint(
		request: RestoreCheckpointRequest,
		signal?: AbortSignal,
	): Promise<RestoreCheckpointResponse> {
		assertMutationDigest(request);
		return this.send(request, signal);
	}

	async close(): Promise<void> {
		this.connected = false;
		await this.requester.close();
	}

	private async send<T extends JsonValue>(
		request: WireRequest<string, JsonObject>,
		signal?: AbortSignal,
	): Promise<WireResponse<T>> {
		try {
			if (!this.connected) {
				await this.requester.connect();
				this.connected = true;
			}
			const response = await this.requester.request<T>(request, {
				receiveTimeoutMs: this.receiveTimeoutMs,
				signal,
			});
			validateWireResponse(request, response);
			return response;
		} catch (error) {
			this.connected = false;
			throw error;
		}
	}
}

export function createBackendClient(
	config: ConnectionConfig,
	options: BackendClientOptions = {},
): BackendClient {
	return new V1BackendClient(
		options.requester ?? new Requester({ connection: config }),
		options,
	);
}

function assertMutationDigest(request: WireRequest<string, JsonObject> & { payloadSha256: string }): void {
	const expected = mutationPayloadSha256(request.body);
	if (request.payloadSha256 !== expected) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Mutation payloadSha256 does not match the canonical request body.",
			retryable: false,
			details: { expectedPayloadSha256: expected },
		});
	}
}

function validateWireResponse(
	request: WireRequest<string, JsonObject>,
	response: WireResponse,
): void {
	if (response.protocolVersion !== HOPPER_PROTOCOL_VERSION) {
		throw new HopperCoreError({
			code: "protocol_mismatch",
			message: `Backend protocol version ${response.protocolVersion} is not supported.`,
			retryable: false,
		});
	}
	if (response.requestId !== request.requestId) {
		throw new HopperCoreError({
			code: "protocol_mismatch",
			message: `Backend response request ID ${response.requestId} did not match ${request.requestId}.`,
			retryable: false,
		});
	}
}

