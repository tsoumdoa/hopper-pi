import type { HopperProgressUpdate, HopperResult, HopperTextContent } from "../core/tool-contract.js";
import type { CommandAction } from "../types/commands.js";
import { submitCommand, type SubmitResult } from "../infra/command-dispatch.js";
import { formatDefaultResult, formatToolError } from "./result-formatters.js";
import { isAbortError } from "../core/tool-error.js";

type ProgressFn = (msg: HopperProgressUpdate) => void;

type MappedAction = { action: CommandAction; params: unknown };

function normalizeMapped(mapped: MappedAction | MappedAction[] | null): MappedAction[] {
	if (mapped == null) return [];
	return Array.isArray(mapped) ? mapped : [mapped];
}

export function createExecute<P>(
	mapParams: (item: P) => MappedAction | MappedAction[] | null,
	formatMessage: (item: P, result: SubmitResult) => string,
	progressMsg?: (item: P) => string,
) {
	return async (
		_toolCallId: string,
		params: { items: P[] },
		signal: AbortSignal | undefined,
		onUpdate: unknown,
	): Promise<HopperResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		const results: string[] = [];
		let hasError = false;

		for (const p of params.items) {
			signal?.throwIfAborted();
			const actions = normalizeMapped(mapParams(p));

			if (actions.length === 0) {
				continue;
			}

			for (const mapped of actions) {
				const summary = progressMsg?.(p) ?? `Executing ${mapped.action}...`;

				if (progressFn) {
					progressFn({
						content: [{ type: "text" as const, text: summary }],
						details: {},
					});
				}

				try {
					const job = await submitCommand(mapped.action, mapped.params, { signal });
					results.push(formatMessage(p, job));
				} catch (err) {
					if (isAbortError(err)) throw err;
					hasError = true;
					results.push(`${summary} → ERROR: ${err instanceof Error ? err.message : String(err)}`);
					results.push(formatMessage(p, { jobId: `failed: ${err instanceof Error ? err.message : String(err)}` }));
				}
			}
		}

		return {
			content: [{ type: "text" as const, text: results.length > 0 ? results.join("\n") : "OK" }],
			details: {},
			...(hasError ? { isError: true } : {}),
		};
	};
}

export type QueryHandler<T> = (item: T, signal?: AbortSignal) => Promise<string>;

export function createHybridExecute<P extends { action: string; targetId?: string }>(
	queryAction: string,
	queryHandler: QueryHandler<P>,
	mapMutation: (item: P) => MappedAction | MappedAction[] | null,
	formatMessage?: (item: P, result: SubmitResult) => string,
	progressMsg?: (item: P) => string,
) {
	const execute = createExecute(
		mapMutation,
		formatMessage ?? formatDefaultResult as (item: P, result: SubmitResult) => string,
		progressMsg,
	);

	return async (
		_toolCallId: string,
		params: { items: P[] },
		signal: AbortSignal | undefined,
		onUpdate: unknown,
	): Promise<HopperResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		const queryItems = params.items.filter((item) => item.action === queryAction);
		const mutationItems = params.items.filter((item) => item.action !== queryAction);

		const results: string[] = [];
		let hasError = false;

		for (const item of queryItems) {
			signal?.throwIfAborted();
			if (progressFn) {
				progressFn({
					content: [{
						type: "text" as const,
						text: `Querying ${queryAction} on ${item.targetId ?? "unknown"}...`,
					}],
					details: {},
				});
			}
			try {
				results.push(await queryHandler(item, signal));
			} catch (err) {
				if (isAbortError(err)) throw err;
				hasError = true;
				results.push(formatToolError(queryAction, err));
			}
		}

		if (mutationItems.length > 0) {
			const jobResults = await execute(_toolCallId, { items: mutationItems }, signal, onUpdate);
			if (jobResults.content.length > 0 && "text" in jobResults.content[0]) {
				results.push((jobResults.content[0] as HopperTextContent).text);
			}
			hasError ||= jobResults.isError === true;
		}

		return {
			content: [{ type: "text" as const, text: results.join("\n") }],
			details: {},
			...(hasError ? { isError: true } : {}),
		};
	};
}

export function createQueryExecute<P>(
	progressText: string | ((params: P) => string),
	handler: (params: P, onUpdate?: ProgressFn, signal?: AbortSignal) => Promise<HopperResult<unknown>>,
) {
	return async (
		_toolCallId: string,
		params: P,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
	): Promise<HopperResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;
		const text = typeof progressText === "function" ? progressText(params) : progressText;
		progressFn?.({
			content: [{ type: "text" as const, text }],
			details: {},
		});
		return handler(params, progressFn, signal);
	};
}
