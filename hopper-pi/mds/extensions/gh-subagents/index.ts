/**
 * GH Subagents Extension
 *
 * Registers the `gh_loop` tool — a multi-phase subagent pipeline for building
 * Grasshopper definitions: interviewer → computational-designer → gh-expert → canvas-agent → [script agents] → validator.
 *
 * State flows via a markdown file on disk. Each phase is a separate pi subprocess
 * with an isolated context window and focused system prompt.
 */

import { Type } from "typebox";
import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { loadAgents } from "./agents.js";
import { runLoop, readStateFile } from "./orchestrator.js";

interface LoopDetails {
	phase: string;
	verdict: string;
	phaseOutputs: Array<{ phase: string; text: string }>;
	stateFilePath: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: string;
		cost: number;
		turns: number;
	};
}

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return (n / 1000).toFixed(1) + "k";
	return String(Math.round(n / 1000)) + "k";
}

// Phase display config
const PHASE_CONFIG: Record<string, { icon: string; label: string }> = {
	interviewer:           { icon: "[?]",   label: "Interviewer" },
	"computational-designer": { icon: "[cd]",  label: "Comp. Designer" },
	"gh-expert":    { icon: "[exp]",  label: "GH Expert" },
	"canvas-agent": { icon: "[cvs]",  label: "Canvas Agent" },
	"cs-agent":     { icon: "[c#]",   label: "C# Agent" },
	"python-agent": { icon: "[py]",   label: "Python Agent" },
	validator:      { icon: "[val]",  label: "Validator" },
};

function getPhaseIcon(phase: string): string {
	const base = phase.replace(/-retry.*$/, "");
	return PHASE_CONFIG[base]?.icon || "[?]";
}

export default function (pi: ExtensionAPI) {
	const agents = loadAgents();

	pi.registerTool({
		name: "gh_loop",
		label: "GH Build Loop",
		description: [
			"Orchestrates a multi-phase subagent pipeline to build or modify a Grasshopper definition.",
			"",
			"**Pipeline phases (sequential, state-file handoff):**",
			"1. **interviewer** — Understand user request, ask clarifying questions, produce User Brief (no tools)\n",
				"2. **computational-designer** — Break down into computational workflow, data types, pipeline steps (no tools)",
			"3. **gh-expert** — Map logic to specific GH components, produce blueprint (read-only tools)",
			"4. **canvas-agent** — Execute blueprint: place components + wire on canvas",
			"5. **cs-agent / python-agent** — Create script components if needed (conditional)",
			"6. **validator** — Inspect canvas vs spec, auto-fix issues, PASS/FAIL verdict",
			"",
			"**Key design decisions:**",
			"- Interviewer focuses on user intent — asks clarification questions if request is unclear",
			"- GH Expert decides components and produces blueprint without touching canvas",
			"- Canvas Agent handles all placement and wiring execution",
			"- Script agents are conditional and specialized by language",
			"- Validator can retry any preceding phase (max 2 loops)",
			"- State file on disk between phases; each phase = isolated pi subprocess",
			"- Shared GH Conventions reference injected into every phase",
		].join("\n"),

		parameters: Type.Object({
			request: Type.String({
				description: "The client's request describing what to build or modify on the Grasshopper canvas",
			}),
		}),

		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			signal: AbortSignal | undefined,
			onUpdate?: (partial: AgentToolResult<LoopDetails>) => void,
			ctx: { cwd: string },
		) {
			const request = params.request as string;
			if (!request || !request.trim()) {
				return {
					content: [{ type: "text", text: "[FAIL] Missing request parameter." }],
					details: { phase: "error", verdict: "FAIL", phaseOutputs: [], stateFilePath: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: "", cost: 0, turns: 0 } },
				};
			}

			const details: LoopDetails = {
				phase: "init",
				verdict: "",
				phaseOutputs: [],
				stateFilePath: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: "", cost: 0, turns: 0 },
			};

			const emit = () => {
				const last = details.phaseOutputs[details.phaseOutputs.length - 1];
				onUpdate?.({
					content: [{ type: "text", text: "[" + details.phase + "] " + (last ? last.text : "...") }],
					details,
				});
			};

			try {
				const result = await runLoop(
					request,
					agents,
					ctx.cwd,
					signal,
					(phase) => { details.phase = phase; emit(); },
					(phase, text) => {
						details.phaseOutputs.push({ phase, text: text.slice(0, 300) });
						emit();
					},
				);

				details.phase = result.phase;
				details.verdict = result.verdict;
				details.stateFilePath = result.stateFilePath;
				details.usage = result.usage;

				// Determine icon and verdict label
				let icon: string;
				let verdictLabel: string;

				if (result.verdict === "PASS") {
					icon = "[OK]";
					verdictLabel = "[OK] PASS";
				} else if (result.verdict === "PASS_WITH_NOTES") {
					icon = "[WARN]";
					verdictLabel = "[WARN] PASS WITH NOTES";
				} else if (result.verdict === "CLARIFICATION_NEEDED") {
					icon = "[?]";
					verdictLabel = "[?] CLARIFICATION NEEDED";
				} else if (result.verdict === "TOO_COMPLEX") {
					icon = "[!]";
					verdictLabel = "[!] TOO COMPLEX";
				} else {
					icon = "[FAIL]";
					verdictLabel = "[FAIL] FAIL";
				}

				// Build phases summary
				const phaseNames = details.phaseOutputs.map((p) => p.phase);
				const uniquePhases = [...new Set(phaseNames.map((p) => p.replace(/-retry.*$/, "")))];
				const phasesRun = uniquePhases.join(" → ");

				// Check which agents actually ran
				const hasCS = phaseNames.some((p) => p === "cs-agent");
				const hasPy = phaseNames.some((p) => p === "python-agent");

				let summary = "";
				summary += "# GH Loop Complete\n\n";
				summary += "**Verdict:** " + verdictLabel + "\n";
				summary += "**Phases:** " + phasesRun + " (" + result.phase + ")\n";
				if (hasCS) summary += "**Scripts:** C# used\n";
				if (hasPy) summary += "**Scripts:** Python used\n";
				summary += "**State file:** `" + result.stateFilePath + "`\n\n";
				summary += "## Usage\n";
				summary += "- Turns: " + result.usage.turns + "\n";
				summary += "- Input: " + formatTokens(result.usage.input) + "\n";
				summary += "- Output: " + formatTokens(result.usage.output) + "\n";
				summary += "- Cost: $" + result.usage.cost.toFixed(4);

				if (!result.success && result.error) {
					summary += "\n\n## Error\n" + result.error;
				}

				// Show relevant output section depending on where we stopped
				if (result.output) {
					if (result.verdict === "CLARIFICATION_NEEDED" || result.verdict === "TOO_COMPLEX") {
						const brief = result.output.match(/## Computational Brief.*?(?=## |\Z)/s);
						if (brief) summary += "\n\n## Brief\n" + brief[0].slice(0, 2000);
					} else {
						const vm = result.output.match(/## Validation Result.*?(?=## |\Z)/s);
						if (vm) {
							summary += "\n\n## Validator Verdict\n" + vm[0].slice(0, 2000);
						}
					}
				}

				return {
					content: [{ type: "text", text: summary }],
					details,
					isError: !result.success && result.verdict !== "CLARIFICATION_NEEDED" && result.verdict !== "TOO_COMPLEX",
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: "[FAIL] Loop crashed: " + msg }],
					details: { ...details, phase: "crash", verdict: "FAIL" },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const req = (args.request as string) || "";
			const preview = req.length > 60 ? req.slice(0, 60) + "..." : req;
			return new Text(
				theme.fg("toolTitle", theme.bold("[loop] gh_loop ")) + theme.fg("dim", preview),
				0, 0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const d = result.details as LoopDetails | undefined;
			if (!d) return new Text("(no details)", 0, 0);

			let icon: string;
			if (result.isError) {
				icon = theme.fg("error", "[FAIL]");
			} else if (d.verdict === "PASS_WITH_NOTES") {
				icon = theme.fg("warning", "[WARN]");
			} else if (d.verdict === "CLARIFICATION_NEEDED") {
				icon = theme.fg("accent", "[?]");
			} else if (d.verdict === "TOO_COMPLEX") {
				icon = theme.fg("warning", "[!]");
			} else {
				icon = theme.fg("success", "[OK]");
			}

			if (!expanded) {
				const title = icon + " " + theme.fg("toolTitle", theme.bold("gh_loop")) + " " + theme.fg("accent", d.verdict) + " " + theme.fg("muted", "(" + d.phase + ")");
				const u = d.usage;
				const usageLine = theme.fg("dim", d.phaseOutputs.length + " phase outputs / " + u.turns + " turns / $" + u.cost.toFixed(4));
				return new Text(title + "\n" + usageLine, 0, 0);
			}

			const container = new Container();
			const header = icon + " " + theme.fg("toolTitle", theme.bold("gh_loop")) + " " + theme.fg("accent", d.verdict);
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Spacer(1));

			for (const po of d.phaseOutputs) {
				const pIcon = getPhaseIcon(po.phase);
				const basePhase = po.phase.replace(/-retry.*$/, "");
				const phaseLabel = PHASE_CONFIG[basePhase]?.label || po.phase;

				const line = theme.fg("muted", pIcon + " " + phaseLabel + ":") + "  " + theme.fg("dim", po.text);
				container.addChild(new Text(line, 0, 0));
			}

			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", "State: " + d.stateFilePath), 0, 0));

			const u = d.usage;
			const usageText = "Usage: ^" + formatTokens(u.input) + " v" + formatTokens(u.output) + " / " + u.turns + " turns / $" + u.cost.toFixed(4);
			container.addChild(new Text(theme.fg("dim", usageText), 0, 0));

			if (d.stateFilePath) {
				const stateContent = readStateFile(d.stateFilePath);
				if (stateContent && stateContent.charAt(0) !== "(") {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted"), "-- State File --"), 0, 0);
					container.addChild(new Markdown(stateContent.slice(0, 4000), 0, 0));
				}
			}

			return container;
		},
	});
}
