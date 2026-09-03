import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type DelegateTask = {
	name: string;
	prompt: string;
};

type HopperDelegateInput = {
	sharedContext?: string;
	tasks: DelegateTask[];
	maxConcurrency?: number;
	timeoutMs?: number;
	maxOutputChars?: number;
};

type DelegateResult = {
	name: string;
	ok: boolean;
	text: string;
	error?: string;
	elapsedMs: number;
};

export type DelegateExecutionContext = {
	model: ExtensionContext["model"];
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "complete">;
};

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_OUTPUT_CHARS = 4_000;
const MAX_TASKS = 6;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), min), max);
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

function outputTokenLimit(maxChars: number): number {
	return Math.min(8_192, Math.max(256, Math.ceil(maxChars / 2)));
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function formatDelegateResults(results: DelegateResult[]): string {
	return [
		`Parallel delegate results (${results.filter((r) => r.ok).length}/${results.length} ok):`,
		...results.map((result, index) => {
			const heading = `\n## ${index + 1}. ${result.name} — ${result.ok ? "ok" : "failed"} (${result.elapsedMs}ms)`;
			return result.ok
				? `${heading}\n${result.text.trim() || "(no text returned)"}`
				: `${heading}\nERROR: ${result.error ?? result.text}`;
		}),
		"\nMain agent: merge these plans yourself. Do not assume any canvas/Rhino changes were made; delegates ran tool-less.",
	].join("\n");
}

async function runWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await worker(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

export async function runDelegateTask(
	task: DelegateTask,
	input: HopperDelegateInput,
	ctx: DelegateExecutionContext,
	outerSignal?: AbortSignal,
): Promise<DelegateResult> {
	const started = Date.now();
	const maxOutputChars = clampInteger(input.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, 500, 20_000);
	const timeoutMs = clampInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 300_000);
	let timedOut = false;
	const timeoutController = new AbortController();
	const timeout = setTimeout(() => {
		timedOut = true;
		timeoutController.abort(new Error(`delegate timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	timeout.unref?.();
	const signal = outerSignal
		? AbortSignal.any([outerSignal, timeoutController.signal])
		: timeoutController.signal;
	let removeAbortListener = () => {};

	const systemPrompt = [
		"You are a Hopper delegate subagent for Grasshopper/Rhino planning.",
		"You are tool-less and read-only. Do not claim to have edited files, Rhino, or Grasshopper.",
		"Return a concise implementation plan, script/component strategy, risks, and validation notes.",
		"Prefer outputs the main agent can directly merge into gh_quick_scaffold, gh_apply_graph, gh_edit_script, or rh_run_script calls.",
	].join("\n");

	try {
		if (!ctx.model) throw new Error("no active model is available for delegation");
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("delegate cancelled");

		const prompt = [
			input.sharedContext ? `Shared context:\n${input.sharedContext}` : undefined,
			`Delegate task (${task.name}):\n${task.prompt}`,
			"Return only your delegate result; do not ask questions.",
		].filter(Boolean).join("\n\n");

		const aborted = new Promise<never>((_, reject) => {
			const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("delegate cancelled"));
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			removeAbortListener = () => signal.removeEventListener("abort", onAbort);
		});
		const completion = ctx.modelRegistry.complete(
			ctx.model,
			{
				systemPrompt,
				messages: [{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				}],
			},
			{
				signal,
				maxTokens: outputTokenLimit(maxOutputChars),
				maxRetries: 1,
				cacheRetention: "none",
			},
		);
		const response = await Promise.race([completion, aborted]);
		if (response.stopReason === "aborted") throw new Error("delegate request was aborted");
		if (response.stopReason === "error") throw new Error(response.errorMessage || "delegate model request failed");
		const text = assistantText(response);
		return {
			name: task.name,
			ok: true,
			text: truncateText(text, maxOutputChars),
			elapsedMs: Date.now() - started,
		};
	} catch (err) {
		const error = timedOut
			? `delegate timed out after ${timeoutMs}ms`
			: outerSignal?.aborted
				? "delegate cancelled"
				: err instanceof Error ? err.message : String(err);
		return {
			name: task.name,
			ok: false,
			text: "",
			error,
			elapsedMs: Date.now() - started,
		};
	} finally {
		clearTimeout(timeout);
		removeAbortListener();
	}
}

export async function executeHopperDelegate(
	input: HopperDelegateInput,
	ctx: DelegateExecutionContext,
	signal?: AbortSignal,
	onProgress?: (text: string) => void,
): Promise<{ text: string; results: DelegateResult[] }> {
	const tasks = input.tasks.slice(0, MAX_TASKS);
	const concurrency = clampInteger(input.maxConcurrency, Math.min(3, tasks.length), 1, Math.min(MAX_TASKS, tasks.length));
	onProgress?.(`Starting ${tasks.length} tool-less delegates with concurrency ${concurrency}...`);
	const results = await runWithConcurrency(tasks, concurrency, (task) => runDelegateTask(task, input, ctx, signal));
	return { text: formatDelegateResults(results), results };
}

export const hopperDelegateTool = defineTool({
	name: "hopper_delegate",
	label: "Hopper Delegate",
	description:
		"Run 2–6 tool-less subagents in parallel for Grasshopper/Rhino planning/review. " +
		"Delegates cannot edit the live canvas or Rhino document; the main agent must merge results and perform actual gh_/rh_ tool calls.",
	promptSnippet: "Delegate independent planning/review tasks to parallel tool-less subagents",
	promptGuidelines: [
		"Use hopper_delegate after an early gh_quick_scaffold when final Grasshopper logic benefits from parallel planning or review.",
		"Do not use hopper_delegate for live mutations; only the main agent should call gh_* or rh_* editing tools.",
	],
	executionMode: "sequential",
	parameters: Type.Object({
		sharedContext: Type.Optional(Type.String({
			description: "Context all delegates should see, such as user intent, current scaffold refs, canvas summary, constraints, or partial code.",
		})),
		tasks: Type.Array(Type.Object({
			name: Type.String({ description: "Short delegate name, e.g. geometry_logic, script_review, layout." }),
			prompt: Type.String({ description: "Self-contained read-only planning/review prompt for this delegate." }),
		}), { minItems: 2, maxItems: MAX_TASKS }),
		maxConcurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TASKS, description: "Maximum delegates running at once. Default: min(3, task count)." })),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 5_000, maximum: 300_000, description: "Per-delegate timeout in ms. Default: 90000." })),
		maxOutputChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 20_000, description: "Per-delegate output budget and final text limit. Default: 4000." })),
	}),
	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		if (!ctx) {
			return { content: [{ type: "text", text: "hopper_delegate requires an extension context." }], details: {} };
		}
		const result = await executeHopperDelegate(params as HopperDelegateInput, ctx, signal, (text) => {
			onUpdate?.({ content: [{ type: "text", text }], details: {} });
		});
		return {
			content: [{ type: "text", text: result.text }],
			details: { results: result.results },
		};
	},
});
