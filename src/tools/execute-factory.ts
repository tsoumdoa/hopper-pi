import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type { CommandAction } from "../types/commands.js";
import { submitCommand } from "../infra/command-dispatch.js";
import { formatToolError } from "./result-formatters.js";

type ProgressFn = (msg: { content: TextContent[]; details: unknown }) => void;

type MappedAction = { action: CommandAction; params: unknown };

function normalizeMapped(mapped: MappedAction | MappedAction[] | null): MappedAction[] {
	if (mapped == null) return [];
	return Array.isArray(mapped) ? mapped : [mapped];
}

export function formatMutationSummary(submitted: number, failures: string[]): string {
	const lines = [`Submitted ${submitted} mutation${submitted === 1 ? "" : "s"}.`];
	if (failures.length > 0) {
		lines.push(`${failures.length} failure${failures.length === 1 ? "" : "s"}:`);
		lines.push(...failures);
	}
	return lines.join("\n");
}

export function createExecute<P>(
	mapParams: (item: P) => MappedAction | MappedAction[] | null,
	progressMsg?: (item: P) => string,
) {
	return async (
		_toolCallId: string,
		params: { items: P[] },
		_signal: unknown,
		onUpdate: unknown,
	): Promise<AgentToolResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		let submitted = 0;
		const failures: string[] = [];

		for (const p of params.items) {
			let actions: MappedAction[];
			try {
				actions = normalizeMapped(mapParams(p));
			} catch (err) {
				failures.push(err instanceof Error ? err.message : String(err));
				continue;
			}

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
					await submitCommand(mapped.action, mapped.params);
					submitted++;
				} catch (err) {
					failures.push(`${mapped.action}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}

		return {
			content: [{ type: "text" as const, text: formatMutationSummary(submitted, failures) }],
			details: { submitted, failures },
		};
	};
}

export type QueryHandler<T> = (item: T) => Promise<string>;

export function createHybridExecute<P extends { action: string; targetId?: string }>(
	queryAction: string,
	queryHandler: QueryHandler<P>,
	mapMutation: (item: P) => MappedAction | MappedAction[] | null,
	progressMsg?: (item: P) => string,
) {
	const execute = createExecute(
		mapMutation,
		progressMsg,
	);

	return async (
		_toolCallId: string,
		params: { items: P[] },
		_signal: unknown,
		onUpdate: unknown,
	): Promise<AgentToolResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		const queryItems = params.items.filter((item) => item.action === queryAction);
		const mutationItems = params.items.filter((item) => item.action !== queryAction);

		const results: string[] = [];

		for (const item of queryItems) {
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
				results.push(await queryHandler(item));
			} catch (err) {
				results.push(formatToolError(queryAction, err));
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

export function createQueryExecute<P>(
	progressText: string | ((params: P) => string),
	handler: (params: P, onUpdate?: ProgressFn) => Promise<AgentToolResult<unknown>>,
) {
	return async (
		_toolCallId: string,
		params: P,
		_signal: unknown,
		onUpdate: unknown,
	): Promise<AgentToolResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;
		const text = typeof progressText === "function" ? progressText(params) : progressText;
		progressFn?.({
			content: [{ type: "text" as const, text }],
			details: {},
		});
		return handler(params, progressFn);
	};
}
