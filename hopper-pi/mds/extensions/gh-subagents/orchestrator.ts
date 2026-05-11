/**
 * Orchestrator — runs the multi-phase GH build pipeline.
 *
 * Pipeline (sequential, state-file handoff):
 *   1. interviewer             → user brief           (pure reasoning, no tools)
 *   2. computational-designer  → computational workflow (pure reasoning, no tools)
 *   3. gh-expert               → blueprint            (component selection, read-only tools)
 *   4. canvas-agent            → build on canvas      (place + wire components)
 *   5. cs-agent / python-agent → scripts              (conditional, parallel)
 *   6. validator               → inspect + verdict     (with retry loop)
 *
 * State flows via a markdown file on disk (not string piping).
 * Each phase receives only the relevant state SECTION(S) — not the full accumulated file —
 * to minimise token re-read costs.
 * GH conventions are provided as a pi skill (on-demand, not injected into every prompt).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agents.js";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

// ─── Types ──────────────────────────────────────────────────────

// ─── Structured result tags (injected into every agent prompt) ──
// Agents emit these exact lines so we can parse phase outcomes reliably.
const RESULT_TAGS = {
	clarificationNeeded: "<!-- GH_RESULT: CLARIFICATION_NEEDED -->",
	tooComplex: "<!-- GH_RESULT: TOO_COMPLEX -->",
	feasible: "<!-- GH_RESULT: FEASIBLE -->",
	pass: "<!-- GH_RESULT: PASS -->",
	passWithNotes: "<!-- GH_RESULT: PASS_WITH_NOTES -->",
	fail: "<!-- GH_RESULT: FAIL -->",
	rerunPhase: (phase: string) => `<!-- GH_RESULT: RERUN_PHASE: ${phase} -->`,
} as const;

/** Extract the result tag from agent output. Returns null if no tag found. */
function extractResultTag(output: string): string | null {
	const match = output.match(/<!-- GH_RESULT: (.*?) -->/);
	return match ? match[1] : null;
}

export interface LoopResult {
	success: boolean;
	verdict: "PASS" | "FAIL" | "PASS_WITH_NOTES" | "CLARIFICATION_NEEDED" | "TOO_COMPLEX";
	phase: string;
	stateFilePath: string;
	output: string;
	usage: UsageStats;
	error?: string;
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: string;
	cost: number;
	turns: number;
}

/** Per-phase timeout in milliseconds (5 minutes). */
const PHASE_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Phase ordering (for resume-from-checkpoint) ────────────────

const PHASE_ORDER = [
	"interviewer",
	"computational-designer",
	"gh-expert",
	"canvas-agent",
	"script-agents",       // marker: cs-agent + python-agent run here
	"validator",
] as const;

/** Returns the next phase name after the given one, or undefined if at end. */
function nextPhase(current: string): typeof PHASE_ORDER[number] | undefined {
	const idx = PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number]);
	if (idx === -1 || idx >= PHASE_ORDER.length - 1) return undefined;
	return PHASE_ORDER[idx + 1];
}

// ─── State File ─────────────────────────────────────────────────

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
		.slice(0, 40);
}

export function createStateFile(cwd: string, request: string): string {
	const slug = slugify(request) || "gh-build";
	const filename = `gh-state-${slug}-${Date.now()}.md`;
	const filePath = path.join(cwd, filename);

	const content = [
		`# GH State: ${slug}`,
		"",
		"## Meta",
		`- **Created:** ${new Date().toISOString()}`,
		"- **Current Phase:** interviewer",
		"- **Status:** in-progress",
		"",
		"## Client Request",
		"> " + request.replace(/\n/g, "\n> "),
		"",
	].join("\n");

	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

export function appendToState(filePath: string, phaseName: string, content: string): void {
	const marker = `\n## ${phaseName}\n\n`;
	const timestamp = `- **Updated:** ${new Date().toISOString()}\n\n`;

	fs.appendFileSync(filePath, marker + timestamp + content + "\n\n", "utf-8");

	let state = fs.readFileSync(filePath, "utf-8");
	state = state.replace(
		/- \*\*Current Phase:\*\* .*/,
		`- **Current Phase:** ${phaseName}`,
	);
	fs.writeFileSync(filePath, state, "utf-8");
}

export function readStateFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return `(state file not found: ${filePath})`;
	}
}

/**
 * Extract a markdown section from state content by header name.
 * Used to pass only relevant slices to each phase — avoids re-reading the full
 * accumulated file (which can grow to 40–100 KB across the pipeline).
 */
function extractSection(state: string, header: string): string {
	const match = state.match(new RegExp("## " + header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?(?=## |$)"));
	return match ? match[0] : "";
}

/**
 * Build a compact phase task prompt using only the relevant state sections.
 * Replaces the old pattern of pointing agents to the full state file.
 */
function buildPhaseTask(
	phaseNum: string,
	phaseName: string,
	sections: Record<string, string>,
	instruction: string,
): string {
	const lines: string[] = [
		`**Phase ${phaseNum}/6 — ${phaseName}**`,
		"",
	];
	for (const [label, content] of Object.entries(sections)) {
		lines.push(`## ${label}`);
		lines.push(content);
		lines.push("");
	}
	lines.push(instruction);
	return lines.join("\n");
}

/** Update a specific meta field in the state file. */
function updateStateMeta(filePath: string, key: string, value: string): void {
	let state = fs.readFileSync(filePath, "utf-8");
	state = state.replace(
		new RegExp(`- \\*\\*${key}:\\*\\* .*`),
		`- **${key}:** ${value}`,
	);
	fs.writeFileSync(filePath, state, "utf-8");
}

// ─── Skill path resolver ────────────────────────────────────────

function getConventionsSkillPath(): string {
	return path.join(
		path.dirname(new URL(import.meta.url).pathname),
		"skills", "gh-conventions",
	);
}

// ─── Subprocess runner ──────────────────────────────────────────

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	if (/^(node|bun)(\.exe)?$/.test(execName)) {
		const resolver = execName.startsWith("bun") ? "bunx" : "npx";
		return { command: resolver, args: ["-y", "@earendil-works/pi-coding-agent", ...args] };
	}

	return { command: process.execPath, args };
}

/**
 * Build the filtered result-tag instructions for an agent.
 * Only includes tags the agent actually uses (from frontmatter relevant_tags).
 */
function buildResultTagInstructions(agent: AgentConfig): string {
	const tags = agent.relevantTags;
	if (!tags || tags.length === 0) return "";

	const BT = "`";
	const lines: string[] = [];

	for (const tag of tags) {
		switch (tag) {
			case "CLARIFICATION_NEEDED":
				lines.push(BT + RESULT_TAGS.clarificationNeeded + BT + " — if you need more information from the user");
				break;
			case "TOO_COMPLEX":
				lines.push(BT + RESULT_TAGS.tooComplex + BT + " — if the task is beyond what can be reliably built");
				break;
			case "FEASIBLE":
				lines.push(BT + RESULT_TAGS.feasible + BT + " — if you produced a valid blueprint / proceed");
				break;
			case "PASS":
				lines.push(BT + RESULT_TAGS.pass + BT + " — if everything checks out");
				break;
			case "PASS_WITH_NOTES":
				lines.push(BT + RESULT_TAGS.passWithNotes + BT + " — if it works but has warnings");
				break;
			case "FAIL":
				lines.push(BT + RESULT_TAGS.fail + BT + " — if there are issues that need fixing");
				break;
			case "RERUN_PHASE":
				lines.push(BT + "<!-- GH_RESULT: RERUN_PHASE: <phase_name> -->" + BT + " — if you want a specific phase re-run");
				break;
		}
	}

	if (lines.length === 0) return "";

	return [
		"You MUST include exactly one of the following lines in your output to indicate your result:",
		...lines,
		"Place the tag on its own line near the end of your output, after your main content.",
	].join("\n");
}

async function runAgent(
	agent: AgentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate?: (text: string) => void,
): Promise<{ exitCode: number; output: string; stderr: string; usage: UsageStats }> {
	const args = [
		"--mode", "json",
		"-p",
		"--no-session",
	];

	// Tool configuration
	if (agent.disableTools) {
		args.push("--tools", "none");
	} else if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}
	// If tools is omitted entirely → pi uses its default toolset

	// Register GH conventions as an on-demand skill (not injected into prompt)
	const skillPath = getConventionsSkillPath();
	if (fs.existsSync(skillPath)) {
		args.push("--skill", skillPath);
	}

	let tmpDir: string | null = null;
	let tmpPath: string | null = null;

	// Build system prompt: agent-specific instructions + filtered result tags only
	let fullPrompt = agent.systemPrompt;

	const tagInstructions = buildResultTagInstructions(agent);
	if (tagInstructions) {
		fullPrompt += "\n\n---\n\n## Output Requirements\n\n" + tagInstructions;
	}

	if (fullPrompt.trim()) {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gh-loop-"));
		tmpPath = path.join(tmpDir, `prompt-${agent.name}.md`);
		await withFileMutationQueue(tmpPath, async () => {
			await fs.promises.writeFile(tmpPath!, fullPrompt, { encoding: "utf-8", mode: 0o600 });
		});
		args.push("--append-system-prompt", tmpPath);
	}

	args.push(`Task: ${task}`);

	const usage: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: "", cost: 0, turns: 0 };
	let output = "";
	let stderr = "";

	const exitCode = await Promise.race([
		new Promise<number>((resolve, reject) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: unknown;
				try { event = JSON.parse(line); } catch { return; }

				const e = event as Record<string, unknown>;

				if (e.type === "message_end" && e.message) {
					const msg = e.message as Message;
					if (msg.role === "assistant") {
						usage.turns++;
						const u = msg.usage;
						if (u) {
							usage.input += u.input || 0;
							usage.output += u.output || 0;
							usage.cacheRead += u.cacheRead || 0;
							usage.cacheWrite += String(u.cacheWrite || 0);
							usage.cost += u.cost?.total || 0;
						}
						for (const part of msg.content) {
							if (part.type === "text") {
								output += part.text;
								onUpdate?.(part.text);
							}
						}
					}
				}
			};

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

			proc.on("close", (code: number | null) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 1);
			});

			proc.on("error", () => resolve(1));

			if (signal) {
				const killProc = () => {
					proc.kill("SIGTERM");
					setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		}),
		// Per-phase timeout guard
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Phase '${agent.name}' timed out after ${PHASE_TIMEOUT_MS / 1000}s`)),
				PHASE_TIMEOUT_MS,
			)
		),
	]).catch((err): number => {
		// If the rejection was our timeout, return exit code for timeout
		if (err instanceof Error && err.message.includes("timed out")) {
			stderr += `\n[TIMEOUT] ${err.message}`;
			return 124; // standard timeout exit code
		}
		throw err; // re-throw unexpected errors (like abort)
	});

	if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
	if (tmpDir) try { fs.rmdirSync(tmpDir); } catch {}

	return { exitCode, output, stderr, usage };
}

// ─── Main loop ──────────────────────────────────────────────────

const MAX_VALIDATOR_RETRIES = 2;

export interface LoopOptions {
	/** Path to an existing state file to resume from (checkpoint). */
	resumeFrom?: string;
}

export async function runLoop(
	request: string,
	agents: AgentConfig[],
	cwd: string,
	signal: AbortSignal | undefined,
	onPhaseStart?: (phase: string) => void,
	onPhaseOutput?: (phase: string, text: string) => void,
	options?: LoopOptions,
): Promise<LoopResult> {
	// Helper: check abort between phases
	const checkAbort = (filePath: string): boolean => {
		if (signal?.aborted) {
			updateStateMeta(filePath, "Status", "aborted");
			return true;
		}
		return false;
	};

	const findAgent = (name: string): AgentConfig | undefined =>
		agents.find((a) => a.name === name);

	// ── Resume or create state file ──────────────────────────
	let stateFilePath: string;
	let startFromIndex = 0; // which phase to start from (index into PHASE_ORDER)

	if (options?.resumeFrom && fs.existsSync(options.resumeFrom)) {
		stateFilePath = options.resumeFrom;
		// Determine last completed phase from state file meta
		const existing = readStateFile(stateFilePath);
		const phaseMatch = existing.match(/- \*\*Current Phase:\*\* (.*)/);
		const lastPhase = phaseMatch?.[1]?.trim();

		if (lastPhase && lastPhase !== "done") {
			// Find where we are — start from the phase AFTER the current one
			const idx = PHASE_ORDER.indexOf(lastPhase as typeof PHASE_ORDER[number]);
			if (idx !== -1) {
				startFromIndex = idx + 1; // resume from next phase
			}
		} else if (lastPhase === "done") {
			// Already complete — re-read final result
			return {
				success: true,
				verdict: "PASS",
				phase: "validator",
				stateFilePath,
				output: existing,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: "", cost: 0, turns: 0 },
			};
		}
	} else {
		stateFilePath = createStateFile(cwd, request);
	}

	const totalUsage: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: "", cost: 0, turns: 0 };

	const addUsage = (u: UsageStats) => {
		totalUsage.input += u.input;
		totalUsage.output += u.output;
		totalUsage.cacheRead += u.cacheRead;
		totalUsage.cacheWrite = String(Number(totalUsage.cacheWrite) + Number(u.cacheWrite));
		totalUsage.cost += u.cost;
		totalUsage.turns += u.turns;
	};

	// Helper: skip phases before startFromIndex
	const shouldRun = (phaseName: string): boolean => {
		if (startFromIndex === 0) return true;
		const idx = PHASE_ORDER.indexOf(phaseName as typeof PHASE_ORDER[number]);
		return idx >= startFromIndex;
	};

	// ── State cache: read once, reuse across phases ──────────
	// The state file grows with each phase. Instead of re-reading the full accumulated
	// file every time, we parse it once and extract only the sections each phase needs.
	let stateCache: string | null = null;
	const readStateOnce = (): string => {
		if (!stateCache) stateCache = readStateFile(stateFilePath);
		return stateCache;
	};
	/** Invalidate cache after a phase writes to the file — forces re-read next time. */
	const invalidateState = () => { stateCache = null; };
	const getSection = (header: string): string => extractSection(readStateOnce(), header);

	// ════════════════════════════════════════════════════════════
	// PHASE 1: INTERVIEWER
	// ════════════════════════════════════════════════════════════
	if (shouldRun("interviewer")) {
		const interviewer = findAgent("interviewer");
		if (!interviewer) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'interviewer' not found", usage: totalUsage, error: "Missing interviewer agent" };
		}

		onPhaseStart?.("interviewer");

		// Only the raw request needed — no state file content yet
		const interviewerTask = [
			"**Phase 1/6 — Interviewer**",
			"",
			"## Client Request",
			request,
			"",
			"Produce your User Brief (see your system prompt for the required format) and write it to the state file below.",
			"State file: " + stateFilePath,
		].join("\n");

		const interviewResult = await runAgent(interviewer, interviewerTask, cwd, signal, (text) => onPhaseOutput?.("interviewer", text));
		addUsage(interviewResult.usage);

		if (checkAbort(stateFilePath)) {
			return { success: false, verdict: "FAIL", phase: "interviewer", stateFilePath, output: interviewResult.output, usage: totalUsage, error: "Aborted by user" };
		}

		if (interviewResult.exitCode !== 0) {
			return {
				success: false, verdict: "FAIL", phase: "interviewer",
				stateFilePath, output: interviewResult.output || interviewResult.stderr,
				usage: totalUsage, error: `Interviewer failed (exit ${interviewResult.exitCode}): ${interviewResult.stderr.slice(0, 500)}`,
			};
		}

		const interviewTag = extractResultTag(interviewResult.output);

		if (interviewTag === "CLARIFICATION_NEEDED") {
			updateStateMeta(stateFilePath, "Status", "awaiting clarification");
			return {
				success: false, verdict: "CLARIFICATION_NEEDED", phase: "interviewer",
				stateFilePath, output: interviewResult.output,
				usage: totalUsage,
				error: "Interviewer needs clarification before proceeding. See User Brief for questions.",
			};
		}
	}

	// ════════════════════════════════════════════════════════════
	// PHASE 2: COMPUTATIONAL DESIGNER
	// ════════════════════════════════════════════════════════════
	if (shouldRun("computational-designer")) {
		const compDesigner = findAgent("computational-designer");
		if (!compDesigner) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'computational-designer' not found", usage: totalUsage, error: "Missing computational-designer agent" };
		}

		onPhaseStart?.("computational-designer");

		// Only User Brief section needed — not the full accumulated file
		const compDesignTask = buildPhaseTask(
			"2", "Computational Designer",
			{
				"Client Request": request,
				"User Brief": getSection("User Brief"),
			},
			"Read the User Brief, produce your Computational Workflow, and write it to the state file.",
		);

		const compDesignResult = await runAgent(compDesigner, compDesignTask, cwd, signal, (text) => onPhaseOutput?.("computational-designer", text));
		addUsage(compDesignResult.usage);
		invalidateState(); // state file grew — force re-parse on next read

		if (checkAbort(stateFilePath)) {
			return { success: false, verdict: "FAIL", phase: "computational-designer", stateFilePath, output: compDesignResult.output, usage: totalUsage, error: "Aborted by user" };
		}

		if (compDesignResult.exitCode !== 0) {
			return {
				success: false, verdict: "FAIL", phase: "computational-designer",
				stateFilePath, output: compDesignResult.output || compDesignResult.stderr,
				usage: totalUsage, error: `Computational Designer failed (exit ${compDesignResult.exitCode}): ${compDesignResult.stderr.slice(0, 500)}`,
			};
		}

		const compTag = extractResultTag(compDesignResult.output);

		if (compTag === "TOO_COMPLEX") {
			return {
				success: false, verdict: "TOO_COMPLEX", phase: "computational-designer",
				stateFilePath, output: compDesignResult.output,
				usage: totalUsage,
				error: "Computational Designer marked this as too complex. See Workflow for simplification suggestions.",
			};
		}

		if (compTag === "CLARIFICATION_NEEDED") {
			return {
				success: false, verdict: "CLARIFICATION_NEEDED", phase: "computational-designer",
				stateFilePath, output: compDesignResult.output,
				usage: totalUsage,
				error: "Computational Designer needs more info from the user. See Workflow for what's missing.",
			};
		}
	}

	// ════════════════════════════════════════════════════════════
	// PHASE 3: GH EXPERT
	// ════════════════════════════════════════════════════════════
	if (shouldRun("gh-expert")) {
		const ghExpert = findAgent("gh-expert");
		if (!ghExpert) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'gh-expert' not found", usage: totalUsage, error: "Missing gh-expert agent" };
		}

		onPhaseStart?.("gh-expert");

		// Only the workflow section needed — not prior phases' full content
		const expertTask = buildPhaseTask(
			"3", "GH Expert",
			{
				"Client Request": request,
				"Computational Workflow": getSection("Computational Workflow"),
			},
			"Read the Computational Workflow, produce your GH Blueprint, and write it to the state file.\nUse gh_list_components() to discover Type GUIDs. Use /skill:gh-conventions for build rules if needed.",
		);

		const expertResult = await runAgent(ghExpert, expertTask, cwd, signal, (text) => onPhaseOutput?.("gh-expert", text));
		addUsage(expertResult.usage);
		invalidateState();

		if (checkAbort(stateFilePath)) {
			return { success: false, verdict: "FAIL", phase: "gh-expert", stateFilePath, output: expertResult.output, usage: totalUsage, error: "Aborted by user" };
		}

		if (expertResult.exitCode !== 0) {
			return {
				success: false, verdict: "FAIL", phase: "gh-expert",
				stateFilePath, output: expertResult.output || expertResult.stderr,
				usage: totalUsage, error: `GH Expert failed (exit ${expertResult.exitCode}): ${expertResult.stderr.slice(0, 500)}`,
			};
		}

		const expertTag = extractResultTag(expertResult.output);

		if (expertTag === "TOO_COMPLEX") {
			return {
				success: false, verdict: "TOO_COMPLEX", phase: "gh-expert",
				stateFilePath, output: expertResult.output,
				usage: totalUsage,
				error: "GH Expert marked this as too complex. See Blueprint for simplification suggestions.",
			};
		}

		if (expertTag === "CLARIFICATION_NEEDED") {
			return {
				success: false, verdict: "CLARIFICATION_NEEDED", phase: "gh-expert",
				stateFilePath, output: expertResult.output,
				usage: totalUsage,
				error: "GH Expert needs more clarity. See Blueprint for what's missing.",
			};
		}
	}

	// ════════════════════════════════════════════════════════════
	// PHASE 4: CANVAS AGENT
	// ════════════════════════════════════════════════════════════
	if (shouldRun("canvas-agent")) {
		const canvasAgent = findAgent("canvas-agent");
		if (!canvasAgent) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'canvas-agent' not found", usage: totalUsage, error: "Missing canvas-agent agent" };
		}

		onPhaseStart?.("canvas-agent");

		// Only the blueprint section needed — the canvas agent's job is to execute it
		const canvasTask = buildPhaseTask(
			"4", "Canvas Agent",
			{
				"GH Blueprint": getSection("GH Blueprint"),
			},
			"Read the Blueprint and execute it on canvas. Write your Canvas Build Result to the state file.\nUse /skill:gh-conventions for layout/visibility rules if needed.",
		);

		const canvasResult = await runAgent(canvasAgent, canvasTask, cwd, signal, (text) => onPhaseOutput?.("canvas-agent", text));
		addUsage(canvasResult.usage);
		invalidateState();

		if (checkAbort(stateFilePath)) {
			return { success: false, verdict: "FAIL", phase: "canvas-agent", stateFilePath, output: canvasResult.output, usage: totalUsage, error: "Aborted by user" };
		}

		if (canvasResult.exitCode !== 0) {
			return {
				success: false, verdict: "FAIL", phase: "canvas-agent",
				stateFilePath, output: canvasResult.output || canvasResult.stderr,
				usage: totalUsage, error: `Canvas Agent failed (exit ${canvasResult.exitCode}): ${canvasResult.stderr.slice(0, 500)}`,
			};
		}
	}

	// ════════════════════════════════════════════════════════════
	// PHASE 5: SCRIPT AGENTS (conditional, parallel)
	// ════════════════════════════════════════════════════════════

	// Read only the blueprint section (not the full state) to detect script needs.
	// The state file may still be small here so re-reading is cheap, but we still
	// scope to avoid accidentally matching "C#" in earlier sections.
	const stateAfterCanvas = readStateOnce();
	const blueprintSection = getSection("GH Blueprint") || getSection("Canvas Build Result");

	const hasCSharpScripts = /csharp[^\w]|c#|c sharp/i.test(blueprintSection)
		&& !/no (c#|csharp|python)?\s*(scripts?)?\s*(needed|required).*standard components/i.test(blueprintSection);
	const hasPythonScripts = /python(?!-agent)[^\w]/i.test(blueprintSection)
		&& !/no (c#|csharp|python)?\s*(scripts?)?\s*(needed|required).*standard components/i.test(blueprintSection);

	interface ScriptAgentResult {
		name: string;
		result: { exitCode: number; output: string; stderr: string; usage: UsageStats };
	}

	const scriptTasks: Array<Promise<ScriptAgentResult | null>> = [];

	// --- C# Agent ---
	if (hasCSharpScripts && shouldRun("script-agents")) {
		const csAgent = findAgent("cs-agent");
		if (!csAgent) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'cs-agent' not found but C# scripts needed", usage: totalUsage, error: "Missing cs-agent agent" };
		}

		onPhaseStart?.("cs-agent");

		// Only the script specs section needed
		const csTask = buildPhaseTask(
			"5a", "C# Script Agent",
			{
				"C# Script Specs": getSection("Script Specs") || "[see Canvas Build Result for C# component entries]",
			},
			"Read the script specs, write code into the pre-created script components, and write your result to the state file.\nUse /skill:gh-conventions for C# boilerplate rules if needed.",
		);

		scriptTasks.push(
			runAgent(csAgent, csTask, cwd, signal, (text) => onPhaseOutput?.("cs-agent", text))
				.then((result) => ({ name: "cs-agent", result }))
		);
	} else if (!hasCSharpScripts) {
		onPhaseOutput?.("cs-agent", "(skipped — no C# scripts needed)");
	}

	// --- Python Agent ---
	if (hasPythonScripts && shouldRun("script-agents")) {
		const pyAgent = findAgent("python-agent");
		if (!pyAgent) {
			return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'python-agent' not found but Python scripts needed", usage: totalUsage, error: "Missing python-agent agent" };
		}

		onPhaseStart?.("python-agent");

		const pyTask = buildPhaseTask(
			"5b", "Python Script Agent",
			{
				"Python Script Specs": getSection("Script Specs") || "[see Canvas Build Result for Python component entries]",
			},
			"Read the Python script specs from the state file, create components, write code, and write your result to the state file.\nUse /skill:gh-conventions for scripting rules if needed.",
		);

		scriptTasks.push(
			runAgent(pyAgent, pyTask, cwd, signal, (text) => onPhaseOutput?.("python-agent", text))
				.then((result) => ({ name: "python-agent", result }))
		);
	} else if (!hasPythonScripts) {
		onPhaseOutput?.("python-agent", "(skipped — no Python scripts needed)");
	}

	// Run all script agents in parallel, process results sequentially
	if (scriptTasks.length > 0) {
		const scriptResults = await Promise.all(scriptTasks);

		for (const sr of scriptResults) {
			if (!sr) continue;

			addUsage(sr.result.usage);
			invalidateState();

			if (sr.result.exitCode !== 0) {
				return {
					success: false, verdict: "FAIL", phase: sr.name,
					stateFilePath, output: sr.result.output || sr.result.stderr,
					usage: totalUsage, error: `${sr.name === "cs-agent" ? "C#" : "Python"} Agent failed (exit ${sr.result.exitCode}): ${sr.result.stderr.slice(0, 500)}`,
				};
			}
		}
	}

	if (checkAbort(stateFilePath)) {
		return { success: false, verdict: "FAIL", phase: "script-agents", stateFilePath, output: "", usage: totalUsage, error: "Aborted by user" };
	}

	// ════════════════════════════════════════════════════════════
	// PHASE 6: VALIDATOR (with retry loop)
	// ════════════════════════════════════════════════════════════
	const validator = findAgent("validator");
	if (!validator) {
		return { success: false, verdict: "FAIL", phase: "setup", stateFilePath, output: "Agent 'validator' not found", usage: totalUsage, error: "Missing validator agent" };
	}

	onPhaseStart?.("validator");

	for (let attempt = 0; attempt <= MAX_VALIDATOR_RETRIES; attempt++) {
		const isRetry = attempt > 0;

		// On retry, include validator feedback from the previous attempt instead of
		// forcing the validator to re-parse the full state file for context
		const valTask = buildPhaseTask(
			"6", `Validator${isRetry ? ` (retry ${attempt}/${MAX_VALIDATOR_RETRIES})` : ""}`,
			isRetry
				? {
					"Previous Verdict": valResult.output.slice(0, 3000),
					"State File": stateFilePath,
				}
				: {
					"State File": stateFilePath,
				},
			"Read the state file, inspect the live canvas, verify end-to-end compliance, auto-fix safe issues, produce verdict.\nWrite your Validation Result to the state file.",
		);

		let valResult: { exitCode: number; output: string; stderr: string; usage: UsageStats };

		// On retry 1+, valResult is already bound above — use it directly
		if (isRetry && attempt > 1) {
			// Already set from previous iteration
		}

		valResult = await runAgent(validator, valTask, cwd, signal, (text) => onPhaseOutput?.("validator", text));
		addUsage(valResult.usage);
		invalidateState();

		if (checkAbort(stateFilePath)) {
			return { success: false, verdict: "FAIL", phase: "validator", stateFilePath, output: valResult.output, usage: totalUsage, error: "Aborted by user" };
		}

		const valTag = extractResultTag(valResult.output);

		if (valTag === "PASS" || valTag === "PASS_WITH_NOTES") {
			updateStateMeta(stateFilePath, "Status", "complete");
			updateStateMeta(stateFilePath, "Current Phase", "done");

			return {
				success: true,
				verdict: valTag === "PASS_WITH_NOTES" ? "PASS_WITH_NOTES" : "PASS",
				phase: "validator",
				stateFilePath,
				output: valResult.output,
				usage: totalUsage,
			};
		}

		// FAIL — check if we should retry a specific phase
		if (attempt < MAX_VALIDATOR_RETRIES) {
			const retryFromTag = valResult.output.match(/<!-- GH_RESULT: RERUN_PHASE: (\w[\w-]*) -->/)?.[1];

			if (retryFromTag) {
				onPhaseStart?.(`${retryFromTag} (retry)`);

				const retryAgent = findAgent(retryFromTag);
				if (!retryAgent) break;

				const retryTargetMap: Record<string, { phaseNum: string; section: string }> = {
					interviewer:             { phaseNum: "1", section: "User Brief" },
					"computational-designer": { phaseNum: "2", section: "Computational Workflow" },
					"gh-expert":             { phaseNum: "3", section: "GH Blueprint" },
					"canvas-agent":          { phaseNum: "4", section: "Canvas Build Result" },
					"cs-agent":              { phaseNum: "5a", section: "C# Scripts Built" },
					"python-agent":          { phaseNum: "5b", section: "Python Scripts Built" },
				};

				const target = retryTargetMap[retryFromTag] || { phaseNum: "?", section: "output section" };

				// Pass only the validator's feedback + the specific section that needs fixing
				// instead of the full state file
				const retryTask = buildPhaseTask(
					target.phaseNum + "/6", `${retryFromTag} (retry)`,
					{
						"Validator Feedback": valResult.output.slice(0, 3000),
						[target.section]: getSection(target.section),
					},
					`Fix the issues flagged by the validator and update the ${target.section} in the state file.`,
				);

				const retryResult = await runAgent(retryAgent, retryTask, cwd, signal, (text) => onPhaseOutput?.(`${retryFromTag}-retry`, text));
				addUsage(retryResult.usage);
				invalidateState();

				if (retryResult.exitCode !== 0) break;
				// Loop back to validator
			} else {
				onPhaseOutput?.("validator", `No specific retry target. Retrying validator (${attempt + 1}/${MAX_VALIDATOR_RETRIES})...`);
			}
		}
	}

	// Exhausted retries
	updateStateMeta(stateFilePath, "Status", "failed (retries exhausted)");

	return {
		success: false,
		verdict: "FAIL",
		phase: "validator",
		stateFilePath,
		output: readStateFile(stateFilePath),
		usage: totalUsage,
		error: `Validator did not pass after ${MAX_VALIDATOR_RETRIES + 1} attempts`,
	};
}