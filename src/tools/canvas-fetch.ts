import { Requester } from "../infra/requester.js";
import { withRequester } from "../infra/request-helpers.js";
import type {
	GetCanvasErrorsResponse,
	GetCurrentCanvasResponse,
	GetScriptCodeResponse,
	ListAllComponentsResponse,
	ListScriptParamsResponse,
} from "../types/messages.js";

let _components: ListAllComponentsResponse | null = null;

export async function getCachedOrFetchComponents(): Promise<ListAllComponentsResponse> {
	if (_components) return _components;
	const data = await withRequester(fetchAllComponents);
	_components = data;
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
