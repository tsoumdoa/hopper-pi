import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type { CommandAction } from "../types/commands.js";
import { submitCommand, type SubmitResult } from "../infra/command-dispatch.js";
import { formatDefaultResult, formatToolError } from "./result-formatters.js";
import { ensureJobListenerStarted, waitForJobResults } from "../infra/job-status-listener.js";

const DEFAULT_JOB_RESULT_TIMEOUT_MS = 10_000;

function jobResultTimeoutMs(): number {
	const raw = process.env.HOPPER_JOB_RESULT_TIMEOUT_MS;
	if (!raw) return DEFAULT_JOB_RESULT_TIMEOUT_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_JOB_RESULT_TIMEOUT_MS;
}

type ProgressFn = (msg: { content: TextContent[]; details: unknown }) => void;

type MappedAction = { action: CommandAction; params: unknown };

function normalizeMapped(mapped: MappedAction | MappedAction[] | null): MappedAction[] {
	if (mapped == null) return [];
	return Array.isArray(mapped) ? mapped : [mapped];
}

export function createExecute<P>(
	mapParams: (item: P) => MappedAction | MappedAction[] | null,
	formatMessage: (item: P, result: SubmitResult) => string,
	progressMsg?: (item: P) => string,
	/**
	 * Optional post-mutation summary (e.g. solution error status). Only invoked
	 * when every submitted job reached a terminal state, so old-plugin timeout
	 * fallbacks never produce a stale summary. Failures are swallowed.
	 */
	postSummary?: () => Promise<string | null>,
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

		const results: string[] = [];
		type Submitted = { item: P; jobId?: string; submitError?: string };
		const submitted: Submitted[] = [];

		// Start listening for job-status events before publishing so results
		// (instance/port GUIDs, failures) can be reported inline.
		const listening = await ensureJobListenerStarted();

		for (const p of params.items) {
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
					const job = await submitCommand(mapped.action, mapped.params);
					submitted.push({ item: p, jobId: job.jobId });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					submitted.push({ item: p, submitError: `${summary} → ERROR: ${message}` });
				}
			}
		}

		const jobIds = submitted.flatMap((s) => (s.jobId ? [s.jobId] : []));
		const statuses = listening
			? await waitForJobResults(jobIds, jobResultTimeoutMs())
			: new Map<string, import("../types/messages.js").GhJobStatus>();

		for (const s of submitted) {
			if (!s.jobId) {
				results.push(s.submitError ?? "ERROR: submit failed");
				continue;
			}
			const status = statuses.get(s.jobId);
			const enriched: SubmitResult = {
				jobId: s.jobId,
				...(status?.state ? { state: status.state } : {}),
				...(status?.result ? { result: status.result } : {}),
				...(status?.error ? { error: status.error } : {}),
			};
			results.push(formatMessage(s.item, enriched));
		}

		const allTerminal = jobIds.length > 0 && jobIds.every((id) => statuses.has(id));
		if (postSummary && allTerminal) {
			try {
				const summary = await postSummary();
				if (summary) results.push(summary);
			} catch {
				// Summary is best-effort; never fail the mutation result over it.
			}
		}

		return {
			content: [{ type: "text" as const, text: results.length > 0 ? results.join("\n") : "OK" }],
			details: {},
		};
	};
}

export type QueryHandler<T> = (item: T) => Promise<string>;

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
