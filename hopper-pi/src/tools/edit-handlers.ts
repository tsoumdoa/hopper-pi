import { nanoid } from "nanoid";
import {
	BackendOfflineError,
	backendOfflineToolResult,
	isBackendKnownOffline,
} from "../infra/backend-status-cache.js";
import { getPublisher } from "../infra/publisher.js";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
	CommandAction,
	SubmitJobRequest,
} from "../types/commands.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";

export function formatDefaultResult<T extends { targetId?: string; action: string }>(
	item: T,
	result: SubmitResult,
): string {
	const rawId = item.targetId ?? "N/A";
	return `${item.action} completed. shortId=${rawId} -> resolvedGuid=${resolveInstanceGuid(rawId)}, jobId=${result.jobId}`;
}

export function defaultProgressMsg<T extends { targetId?: string; action: string; componentType?: string }>(
	item: T,
): string {
	return `${item.action} on ${item.targetId ?? item.componentType ?? "unknown"}...`;
}

export function buildJobRequest(action: CommandAction, params: unknown): SubmitJobRequest {
	const jobId = `job-${nanoid(8)}`;
	return {
		type: "submitJob",
		jobId,
		command: { action, params: params as SubmitJobRequest["command"]["params"] },
	};
}

export async function submitCommand(
	action: CommandAction,
	params: unknown,
): Promise<{ jobId: string }> {
	if (isBackendKnownOffline()) {
		throw new BackendOfflineError();
	}
	const request = buildJobRequest(action, params);
	const publisher = getPublisher();
	await publisher.connect();
	await publisher.publishCommand(request);
	return { jobId: request.jobId };
}

export type SubmitResult = { jobId: string };

type ProgressFn = (msg: { content: TextContent[]; details: unknown }) => void;

type MappedAction = { action: CommandAction; params: unknown };

function normalizeMapped(mapped: MappedAction | MappedAction[] | null): MappedAction[] {
	if (mapped == null) return [];
	return Array.isArray(mapped) ? mapped : [mapped];
}

export function createExecute<P>(
	mapParams: (item: P) => MappedAction | MappedAction[] | null,
	_formatMessage: (item: P, result: SubmitResult) => string,
	progressMsg?: (item: P) => string,
) {
	return async (
		_toolCallId: string,
		params: { items: P[] },
		_signal: unknown,
		onUpdate: unknown,
	): Promise<AgentToolResult<unknown>> => {
		if (isBackendKnownOffline()) {
			return backendOfflineToolResult();
		}

		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		for (const p of params.items) {
			const actions = normalizeMapped(mapParams(p));

			if (actions.length === 0) {
				continue;
			}

			for (const mapped of actions) {
				if (progressFn) {
					progressFn({
						content: [{ type: "text" as const, text: progressMsg?.(p) ?? `Executing ${mapped.action}...` }],
						details: {},
					});
				}

				await submitCommand(mapped.action, mapped.params);
			}
		}

		return {
			content: [{ type: "text" as const, text: "OK" }],
			details: {},
		};
	};
}

export type QueryHandler<T> = (item: T) => Promise<string>;

export function createHybridExecute<P>(
	queryAction: string,
	queryHandler: QueryHandler<P>,
	mapMutation: (item: P) => MappedAction | MappedAction[] | null,
	formatMessage?: (item: P, result: SubmitResult) => string,
	progressMsg?: (item: P) => string,
) {
	const execute = createExecute(mapMutation, formatMessage ?? formatDefaultResult as (item: P, result: SubmitResult) => string, progressMsg);

	return async (
		_toolCallId: string,
		params: { items: P[] },
		_signal: unknown,
		onUpdate: unknown,
	): Promise<AgentToolResult<unknown>> => {
		if (isBackendKnownOffline()) {
			return backendOfflineToolResult();
		}

		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		const queryItems = params.items.filter((item) => (item as { action: string }).action === queryAction);
		const mutationItems = params.items.filter((item) => (item as { action: string }).action !== queryAction);

		const results: string[] = [];

		for (const item of queryItems) {
			if (progressFn) {
				progressFn({ content: [{ type: "text" as const, text: `Querying ${queryAction} on ${(item as { targetId?: string }).targetId ?? "unknown"}...` }], details: {} });
			}
			try {
				results.push(await queryHandler(item));
			} catch (err) {
				results.push(`${queryAction} error: ${err}`);
			}
		}

		if (mutationItems.length > 0) {
			const jobResults = await execute(_toolCallId, { items: mutationItems }, _signal, onUpdate);
			if (jobResults.content.length > 0 && "text" in jobResults.content[0]) {
				results.push((jobResults.content[0] as TextContent).text);
			}
		}

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details: {},
		};
	};
}
