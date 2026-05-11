/**
 * Subagent Tool — Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving each an isolated context window with its own system prompt.
 *
 * Supports three modes:
 *   - Single:     { agent: "name", task: "..." }
 *   - Parallel:   { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain:      { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 *
 * Your agents:
 *   intent           — Understand & structure the request
 *   planner          — Break into approach + milestones
 *   graph-architect  — Design GH components + data tree
 *   canvas-designer  — Define placement, layout, readability
 *   script-writer    — Generate C# code
 *   validator        — Check specs + patch issues
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	getMarkdownTheme,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentConfig, AgentScope } from "./agents.js";
import { discoverAgents } from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

// ─── Formatting helpers ──────────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatUsage(
	u: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (u.turns) parts.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (u.input) parts.push(`↑${formatTokens(u.input)}`);
	if (u.output) parts.push(`↓${formatTokens(u.output)}`);
	if (u.cacheRead) parts.push(`R${formatTokens(u.cacheRead)}`);
	if (u.cacheWrite) parts.push(`W${formatTokens(u.cacheWrite)}`);
	if (u.cost) parts.push(`$${u.cost.toFixed(4)}`);
	if (u.contextTokens && u.contextTokens > 0)
		parts.push(`ctx:${formatTokens(u.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text")
					items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall")
					items.push({
						type: "toolCall",
						name: part.name,
						args: part.arguments,
					});
			}
		}
	}
	return items;
}

// ─── Concurrency helper ─────────────────────────────────────────────

async function mapWithConcurrency<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TOut>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: limit }, async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

// ─── Temp file helpers ──────────────────────────────────────────────

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "pi-subagent-"),
	);
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, {
			encoding: "utf-8",
			mode: 0o600,
		});
	});
	return { dir: tmpDir, filePath };
}

// ─── pi binary resolution ───────────────────────────────────────────

function getPiInvocation(args: string[]): {
	command: string;
	args: string[];
} {
	const currentScript = process.argv[1];
	const isBunVirtualScript =
		currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

// ─── Result types ───────────────────────────────────────────────────

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

// ─── Core: run a single agent in a subprocess ──────────────────────

type OnUpdateCallback = (
	partial: AgentToolResult<SubagentDetails>,
) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	currentModel?: { id: string; provider: string } | undefined,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents
			.map((a) => `"${a.name}"`)
			.join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available: ${available}`,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
			step,
		};
	}

	const effectiveModel = agent.model || currentModel?.id;

	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
	];
	if (effectiveModel) args.push("--model", effectiveModel);
	if (agent.tools && agent.tools.length > 0)
		args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		model: agent.model,
		step,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [
					{
						type: "text",
						text:
							getFinalOutput(currentResult.messages) ||
							"(running...)",
					},
				],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		// Write system prompt to temp file if present
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(
				agent.name,
				agent.systemPrompt,
			);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);

		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: unknown;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				const e = event as Record<string, unknown>;

				// Capture assistant messages (streaming output)
				if (e.type === "message_end" && e.message) {
					const msg = e.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output +=
								usage.output || 0;
							currentResult.usage.cacheRead +=
								usage.cacheRead || 0;
							currentResult.usage.cacheWrite +=
								usage.cacheWrite || 0;
							currentResult.usage.cost +=
								usage.cost?.total || 0;
							currentResult.usage.contextTokens =
								usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model)
							currentResult.model = msg.model;
						if (msg.stopReason)
							currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage)
							currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				// Capture tool result messages
				if (e.type === "tool_result_end" && e.message) {
					currentResult.messages.push(e.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data: Buffer) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code: number | null) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			// Abort support — propagate Ctrl+C to child process
			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else
					signal.addEventListener("abort", killProc, {
						once: true,
					});
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		// Cleanup temp files
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

// ─── Tool parameter schemas ─────────────────────────────────────────

const TaskItem = Type.Object({
	agent: Type.String({
		description: "Name of the agent to invoke",
	}),
	task: Type.String({
		description: "Task to delegate to the agent",
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process",
		}),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({
		description: "Name of the agent to invoke",
	}),
	task: Type.String({
		description:
			"Task with optional {previous} placeholder for prior output",
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process",
		}),
	),
});

const AgentScopeSchema = StringEnum(
	["user", "project", "both"] as const,
	{
		description:
			'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
		default: "user",
	},
);

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({
			description: "Task to delegate (for single mode)",
		}),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, {
			description: "Array of {agent, task} for sequential execution",
		}),
	),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description:
				"Prompt before running project-local agents. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				"Working directory for the agent process (single mode)",
		}),
	),
});

// ─── Render helpers ─────────────────────────────────────────────────

function renderDisplayItems(
	items: DisplayItem[],
	expanded: boolean,
	theme: { fg: (color: string, text: string) => string },
): string {
	const toShow = expanded ? items : items.slice(-COLLAPSED_ITEM_COUNT);
	const skipped =
		!expanded && items.length > COLLAPSED_ITEM_COUNT
			? items.length - COLLAPSED_ITEM_COUNT
			: 0;
	let text = "";
	if (skipped > 0)
		text += theme.fg("muted", `... ${skipped} earlier items\n`);
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = expanded
				? item.text
				: item.text.split("\n").slice(0, 3).join("\n");
			text += `${theme.fg("toolOutput", preview)}\n`;
		} else {
			const argsStr =
				JSON.stringify(item.args).length > 50
					? `${JSON.stringify(item.args).slice(0, 50)}...`
					: JSON.stringify(item.args);
			text +=
				theme.fg("muted", "→ ") +
				theme.fg("accent", item.name) +
				theme.fg("dim", ` ${argsStr}\n`);
		}
	}
	return text.trimEnd();
}

function aggregateUsage(results: SingleResult[]) {
	const total = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		turns: 0,
	};
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

// ─── Extension entry point ──────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"",
			"**Available agents:**",
			"`intent` — Analyze & structure the user's request",
			"`planner` — Break into approach + milestones",
			"`graph-architect` — Design GH components + data tree",
			"`canvas-designer` — Define placement, layout, readability",
			"`script-writer` — Generate C# implementation code",
			"`validator` — Validate against specs + patch issues",
			"",
			"**Modes:**",
			"- **Single:** `{ agent: \"name\", task: \"...\" }`",
			"- **Parallel:** `{ tasks: [{ agent, task }, ...] }`",
			"- **Chain:** `{ chain: [{ agent, task }, ...] }` — use `{previous}` to pass output between steps",
			"",
			"**Typical pipeline (chain):**",
			"intent → planner → graph-architect → canvas-designer → script-writer → validator",
		].join("\n"),

		parameters: SubagentParams,

		// ─── Execute ───────────────────────────────────────────────

		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			signal: AbortSignal | undefined,
			onUpdate:
				| ((partial: AgentToolResult<SubagentDetails>) => void)
				| undefined,
			ctx: { cwd: string; hasUI: boolean; ui: { confirm: (title: string, message: string) => Promise<boolean> } },
		) {
			const agentScope: AgentScope =
				(params.agentScope as AgentScope) ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents =
				(params.confirmProjectAgents as boolean | undefined) ?? true;

			const hasChain = ((params.chain as unknown[])?.length ?? 0) > 0;
			const hasTasks = ((params.tasks as unknown[])?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			// Parameter validation
			if (modeCount !== 1) {
				const available = agents
					.map((a) => `${a.name} (${a.source})`)
					.join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode (agent+task, tasks[], or chain[]).\n\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			// Security gate for project-local agents
			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI
			) {
				const requestedNames = new Set<string>();
				if (params.chain)
					for (const step of params.chain as { agent: string }[])
						requestedNames.add(step.agent);
				if (params.tasks)
					for (const t of params.tasks as { agent: string }[])
						requestedNames.add(t.agent);
				if (params.agent)
					requestedNames.add(params.agent as string);

				const projectAgentsRequested = Array.from(requestedNames)
					.map((name) =>
						agents.find((a) => a.name === name),
					)
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested
						.map((a) => a.name)
						.join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [
								{
									type: "text",
									text:
										"Canceled: project-local agents not approved.",
								},
							],
							details:
								makeDetails(
									hasChain
										? "chain"
										: hasTasks
											? "parallel"
											: "single",
								)([]),
						};
				}
			}

			// ─── CHAIN MODE ──────────────────────────────────────
			if (params.chain && (params.chain as unknown[]).length > 0) {
				const chain = params.chain as {
					agent: string;
					task: string;
					cwd?: string;
				}[];
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < chain.length; i++) {
					const step = chain[i];
					const taskWithContext = step.task.replace(
						/\{previous\}/g,
						previousOutput,
					);

					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const current =
									partial.details?.results[0];
								if (current) {
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")([
											...results,
											current,
										]),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
						ctx.model,
					);
					results.push(result);

					const isError =
						result.exitCode !== 0 ||
						result.stopReason === "error" ||
						result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage ||
							result.stderr ||
							getFinalOutput(result.messages) ||
							"(no output)";
						return {
							content: [
								{
									type: "text",
									text: `❌ Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}

				const lastOutput =
					getFinalOutput(
						results[results.length - 1].messages,
					) || "(no output)";
				return {
					content: [
						{
							type: "text",
							text: `✅ Pipeline complete (${results.length} steps)\n\n${lastOutput}`,
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			// ─── PARALLEL MODE ───────────────────────────────────
			if (params.tasks && (params.tasks as unknown[]).length > 0) {
				const tasks = params.tasks as {
					agent: string;
					task: string;
					cwd?: string;
				}[];

				if (tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				const allResults: SingleResult[] = Array.from(
					{ length: tasks.length },
					(_, i) => ({
						agent: tasks[i].agent,
						agentSource: "unknown" as const,
						task: tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							cost: 0,
							contextTokens: 0,
							turns: 0,
						},
					}),
				);

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter(
							(r) => r.exitCode === -1,
						).length;
						const done = allResults.filter(
							(r) => r.exitCode !== -1,
						).length;
						onUpdate({
							content: [
								{
									type: "text",
									text: `⏳ Parallel: ${done}/${allResults.length} done, ${running} running...`,
								},
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrency(
					tasks,
					MAX_CONCURRENCY,
					async (t, index) => {
						const result = await runSingleAgent(
							ctx.cwd,
							agents,
							t.agent,
							t.task,
							t.cwd,
							undefined,
							signal,
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] =
										partial.details.results[0];
									emitParallelUpdate();
								}
							},
							makeDetails("parallel"),
								ctx.model,
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const successCount = results.filter(
					(r) => r.exitCode === 0,
				).length;
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages);
					const preview =
						output.slice(0, 100) +
						(output.length > 100 ? "..." : "");
					return `[${r.agent}] ${
						r.exitCode === 0 ? "✅" : "❌"
					}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			// ─── SINGLE MODE ──────────────────────────────────────
			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent as string,
					params.task as string,
					params.cwd as string | undefined,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
					ctx.model,
				);
				const isError =
					result.exitCode !== 0 ||
					result.stopReason === "error" ||
					result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage ||
						result.stderr ||
						getFinalOutput(result.messages) ||
						"(no output)";
					return {
						content: [
							{
								type: "text",
								text: `❌ Agent ${result.stopReason || "failed"}: ${errorMsg}`,
							},
						],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text:
								getFinalOutput(result.messages) ||
								"(no output)",
						},
					],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents
				.map((a) => `${a.name} (${a.source})`)
				.join(", ") || "none";
			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available agents: ${available}`,
					},
				],
				details: makeDetails("single")([]),
			};
		},

		// ─── Render tool call (TUI display) ──────────────────────

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";

			if (args.chain && (args.chain as unknown[]).length > 0) {
				const chain = args.chain as {
					agent: string;
					task: string;
				}[];
				let text =
					theme.fg("toolTitle", theme.bold("🔗 subagent ")) +
					theme.fg("accent", `pipeline (${chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(chain.length, 6); i++) {
					const step = chain[i];
					const cleanTask = step.task
						.replace(/\{previous\}/g, "")
						.trim();
					const preview =
						cleanTask.length > 35
							? `${cleanTask.slice(0, 35)}...`
							: cleanTask;
					const stepNum =
						i + 1 <= 6
							? `${i + 1}.`
							: `   `;
					text +=
						"\n  " +
						theme.fg("muted", stepNum) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (chain.length > 6)
					text +=
						`\n  ${theme.fg("muted", `... +${chain.length - 6} more`)}`;
				return new Text(text, 0, 0);
			}

			if (args.tasks && (args.tasks as unknown[]).length > 0) {
				const tasks = args.tasks as {
					agent: string;
					task: string;
				}[];
				let text =
					theme.fg("toolTitle", theme.bold("⚡ subagent ")) +
					theme.fg(
						"accent",
						`parallel (${tasks.length} tasks)`,
					) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of tasks.slice(0, 4)) {
					const preview =
						t.task.length > 35
							? `${t.task.slice(0, 35)}...`
							: t.task;
					text +=
						`\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (tasks.length > 4)
					text +=
						`\n  ${theme.fg("muted", `... +${tasks.length - 4} more`)}`;
				return new Text(text, 0, 0);
			}

			const agentName = (args.agent as string) || "...";
			const preview = args.task
				? (args.task as string).length > 60
					? `${(args.task as string).slice(0, 60)}...`
					: (args.task as string)
				: "...";
			let text =
				theme.fg("toolTitle", theme.bold("🤖 subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		// ─── Render result (TUI display) ─────────────────────────

		renderResult(result, { expanded }, theme, _context) {
			const details =
				result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(
					text?.type === "text" ? text.text : "(no output)",
					0,
					0,
				);
			}

			const mdTheme = getMarkdownTheme();

			// ─── Single result ───────────────────────────────────
			if (
				details.mode === "single" &&
				details.results.length === 1
			) {
				const r = details.results[0];
				const isError =
					r.exitCode !== 0 ||
					r.stopReason === "error" ||
					r.stopReason === "aborted";
				const icon = isError
					? theme.fg("error", "❌")
					: theme.fg("success", "✅");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason)
						header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(
							new Text(
								theme.fg("error", `Error: ${r.errorMessage}`),
								0,
								0,
							),
						);
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(theme.fg("muted", "─── Task ───"), 0, 0),
					);
					container.addChild(
						new Text(theme.fg("dim", r.task), 0, 0),
					);
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(
							theme.fg("muted", "─── Output ───"),
							0,
							0,
						),
					);
					if (
						displayItems.length === 0 &&
						!finalOutput
					) {
						container.addChild(
							new Text(
								theme.fg("muted", "(no output)"),
								0,
								0,
							),
						);
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										`${theme.fg("muted", "→ ")}${theme.fg("accent", item.name)} ${theme.fg("dim", JSON.stringify(item.args).slice(0, 80))}`,
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(
								new Markdown(
									finalOutput.trim(),
									0,
									0,
									mdTheme,
								),
							);
						}
					}
					const usageStr = formatUsage(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								theme.fg("dim", usageStr),
								0,
								0,
							),
						);
					}
					return container;
				}

				// Collapsed
				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason)
					text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage)
					text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0)
					text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, false, theme)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT)
						text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsage(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			// ─── Chain result ────────────────────────────────────
			if (details.mode === "chain") {
				const successCount = details.results.filter(
					(r) => r.exitCode === 0,
				).length;
				const icon =
					successCount === details.results.length
						? theme.fg("success", "✅")
						: theme.fg("error", "❌");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("🔗 pipeline"))} ${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon =
							r.exitCode === 0
								? theme.fg("success", "✅")
								: theme.fg("error", "❌");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(
							new Text(
								theme.fg("muted", "Task: ") +
									theme.fg("dim", r.task),
								0,
								0,
							),
						);

						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										`${theme.fg("muted", "→ ")}${theme.fg("accent", item.name)} ${theme.fg("dim", JSON.stringify(item.args).slice(0, 60))}`,
										0,
										0,
									),
								);
						}

						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(
								new Markdown(
									finalOutput.trim(),
									0,
									0,
									mdTheme,
								),
							);
						}

						const stepUsage = formatUsage(r.usage, r.model);
						if (stepUsage)
							container.addChild(
								new Text(
									theme.fg("dim", stepUsage),
									0,
									0,
								),
							);
					}

					const totalUsage = aggregateUsage(details.results);
					const totalStr = formatUsage(totalUsage);
					if (totalStr) {
						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								theme.fg("dim", `Total: ${totalStr}`),
								0,
								0,
							),
						);
					}
					return container;
				}

				// Collapsed chain
				let text =
					icon +
					" " +
					theme.fg(
						"toolTitle",
						theme.bold("🔗 pipeline"),
					) +
					" " +
					theme.fg(
						"accent",
						`${successCount}/${details.results.length} steps`,
					);
				for (const r of details.results) {
					const rIcon =
						r.exitCode === 0
							? theme.fg("success", "✅")
							: theme.fg("error", "❌");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", "(no output)")}`;
					else
						text += `\n${renderDisplayItems(displayItems, false, theme)}`;
				}
				const totalUsage = aggregateUsage(details.results);
				const totalStr = formatUsage(totalUsage);
				if (totalStr)
					text += `\n\n${theme.fg("dim", `Total: ${totalStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			// ─── Parallel result ─────────────────────────────────
			if (details.mode === "parallel") {
				const running = details.results.filter(
					(r) => r.exitCode === -1,
				).length;
				const successCount = details.results.filter(
					(r) => r.exitCode === 0,
				).length;
				const failCount = details.results.filter(
					(r) => r.exitCode > 0 && r.exitCode !== -1,
				).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "⚠️")
						: theme.fg("success", "✅");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("⚡ parallel"))} ${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon =
							r.exitCode === -1
								? theme.fg("warning", "⏳")
								: r.exitCode === 0
									? theme.fg("success", "✅")
									: theme.fg("error", "❌");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", "── ")}${theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(
							new Text(
								theme.fg("muted", "Task: ") +
									theme.fg("dim", r.task),
								0,
								0,
							),
						);

						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										`${theme.fg("muted", "→ ")}${theme.fg("accent", item.name)} ${theme.fg("dim", JSON.stringify(item.args).slice(0, 60))}`,
										0,
										0,
									),
								);
						}

						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(
								new Markdown(
									finalOutput.trim(),
									0,
									0,
									mdTheme,
								),
							);
						}

						const taskUsage = formatUsage(r.usage, r.model);
						if (taskUsage)
							container.addChild(
								new Text(
									theme.fg("dim", taskUsage),
									0,
									0,
								),
							);
					}

					const totalUsage = aggregateUsage(details.results);
					const totalStr = formatUsage(totalUsage);
					if (totalStr) {
						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								theme.fg("dim", `Total: ${totalStr}`),
								0,
								0,
							),
						);
					}
					return container;
				}

				// Collapsed / running parallel
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("⚡ parallel"))}${theme.fg("accent", ` ${status}`)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✅")
								: theme.fg("error", "❌");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else
						text += `\n${renderDisplayItems(displayItems, false, theme)}`;
				}
				if (!isRunning) {
					const totalUsage = aggregateUsage(details.results);
					const totalStr = formatUsage(totalUsage);
					if (totalStr)
						text += `\n\n${theme.fg("dim", `Total: ${totalStr}`)}`;
				}
				if (!expanded)
					text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			// Fallback
			const text = result.content[0];
			return new Text(
				text?.type === "text" ? text.text : "(no output)",
				0,
				0,
			);
		},
	});
}
