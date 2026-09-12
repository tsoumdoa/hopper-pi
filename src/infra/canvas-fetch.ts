import { getRuntimeSessionContext } from "./runtime-session-context.js";
import { Requester } from "./requester.js";
import { withRequester } from "./request-helpers.js";
import { getRuntimeRpc } from "./runtime-rpc.js";
import type {
	GetCanvasErrorsResponse,
	GetCurrentCanvasResponse,
	GetScriptCodeResponse,
	ListAllComponentsResponse,
	ListScriptParamsResponse,
} from "../types/messages.js";

const componentsKey = Symbol("componentCatalog");

export async function getCachedOrFetchComponents(): Promise<ListAllComponentsResponse> {
	const cache = getRuntimeSessionContext().get(componentsKey, () => ({ components: null as ListAllComponentsResponse | null }));
	if (cache.components) {
		await getRuntimeRpc().ensureGrasshopperReady();
		return cache.components;
	}
	const data = await withRequester(fetchAllComponents);
	cache.components = data;
	return data;
}

export async function fetchGh<T>(req: Requester, type: string): Promise<T> {
	return req.request<T>({ type });
}

export async function fetchCurrentCanvas(
	req: Requester,
	options?: { selectionOnly?: boolean },
): Promise<GetCurrentCanvasResponse> {
	return req.request<GetCurrentCanvasResponse>({
		type: "getCurrentCanvas",
		...(options?.selectionOnly ? { selectionOnly: true } : {}),
	});
}

export async function fetchAllComponents(req: Requester): Promise<ListAllComponentsResponse> {
	return fetchGh<ListAllComponentsResponse>(req, "listAllComponents");
}

export async function fetchCanvasErrors(req: Requester): Promise<GetCanvasErrorsResponse> {
	return fetchGh<GetCanvasErrorsResponse>(req, "getCanvasErrors");
}

export async function fetchScriptParams(req: Requester, targetId: string): Promise<ListScriptParamsResponse> {
	return req.request<ListScriptParamsResponse>({ type: "listScriptParams", targetId });
}

export async function fetchScriptCode(req: Requester, targetId: string): Promise<GetScriptCodeResponse> {
	return req.request<GetScriptCodeResponse>({ type: "getScriptCode", targetId });
}
