import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { nanoid } from "nanoid";
import { Subscriber } from "../infra/subscriber.js";
import { Publisher } from "../infra/publisher.js";
import { DEBUG, COMMAND_ACK_TIMEOUT_MS } from "../infra/connection.js";
import type { CommandAction, CommandParams, SubmitJobRequest } from "../types/commands.js";
import { ACTION_REGISTRY } from "../domain/commands.js";
import type { GhMessage, GhJobStatus, GhEventXml } from "../types/messages.js";
import { buildGhJson } from "../services/parser.js";
import { diffGh, formatDiffSummary } from "../services/differ.js";

const ACTIONS = ACTION_REGISTRY.map(({ id, action, label }) => ({ id, action, label }));

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function handleMessage(msg: GhMessage): void {
	if (msg.type === "gh.job.status") {
		const status = msg as GhJobStatus;
		const stateColor =
			status.state === "completed" ? "green" :
				status.state === "failed" ? "red" :
					status.state === "running" ? "yellow" : "gray";
		console.log(
			chalk.blue(`[${msg.type}]`) +
			` ${formatTimestamp(status.timestamp)} — ` +
			chalk.cyan(`${status.jobId}:`) +
			` ${chalk[stateColor](status.state)} ` +
			`(${status.progress}%)`
		);
	}
	if (msg.type === "gh.event.xml") {
		const event = msg as GhEventXml;
		const size = new TextEncoder().encode(event.xml).length;
		console.log(
			chalk.blue(`[${msg.type}]`) +
			` ${formatTimestamp(event.timestamp)} — ` +
			`docName: ${event.docName} (${size} bytes)`
		);
	}
}

export async function subscribe(
	filter?: string,
	saveXml?: boolean
): Promise<void> {
	if (DEBUG) {
		console.log(chalk.gray(`[DEBUG] filter=${filter || "none"} saveXml=${saveXml}`));
	}

	console.log(chalk.bold("Connecting to Grasshopper pub/sub...\n"));

	const subscriber = new Subscriber();
	await subscriber.connect();

	if (filter) {
		await subscriber.subscribeTopic(filter);
	}

	console.log(chalk.green("✓ Connected to PUB socket"));
	console.log("Listening for events...\n");

	try {
		await subscriber.subscribe((msg: GhMessage) => {
			handleMessage(msg);
			if (msg.type === "gh.event.xml" && saveXml) {
				const event = msg as GhEventXml;
				const filename = event.docName.replace(/[^a-zA-Z0-9._-]/g, "_") || "untitled";
				const outPath = `${filename}.xml`;
				fs.writeFileSync(outPath, event.xml);
				console.log(chalk.gray(`  Saved XML to ${outPath}`));
			}
		});
	} catch (err) {
		console.error(chalk.red("Subscriber error:"), err);
	} finally {
		await subscriber.close();
	}
}

export function createSubscribeCommand(program: Command): void {
	program
		.command("subscribe")
		.description("Subscribe to Grasshopper pub/sub events")
		.option("--filter <topic>", "Filter by topic prefix (e.g. gh.job, gh.hello)")
		.option("--save-xml", "Save received XML events to files", false)
		.action(async (opts: { filter?: string; saveXml?: boolean }) => {
			try {
				await subscribe(opts.filter, opts.saveXml);
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

const VALID_ACTIONS = new Set(ACTION_REGISTRY.map((a) => a.action));

function parseParams(action: CommandAction, opts: Record<string, string>): CommandParams {
	const def = ACTION_REGISTRY.find((a) => a.action === action);
	if (!def) throw new Error(`Unknown action: ${action}`);
	const params: Record<string, unknown> = {};
	for (const param of def.params) {
		const raw = opts[param.name];
		params[param.name] = param.parse ? param.parse(raw) : raw;
	}
	return params as unknown as CommandParams;
}

export async function submit(action: string, opts: Record<string, string>): Promise<void> {
	if (!VALID_ACTIONS.has(action as CommandAction)) {
		console.error(chalk.red(`Unknown action: ${action}`));
		console.log(`Valid actions: ${[...VALID_ACTIONS].join(", ")}`);
		process.exit(1);
	}

	const jobId = `job-${nanoid(8)}`;
	const params = parseParams(action as CommandAction, opts);
	const request: SubmitJobRequest = {
		type: "submitJob",
		jobId,
		command: { action: action as CommandAction, params },
	};

	const publisher = new Publisher();
	try {
		await publisher.connect();
		await publisher.publishCommand(request);

		console.log(chalk.gray(`Command published, waiting for ack (jobId: ${chalk.cyan(jobId)})...`));

		const ack = await waitForAck(jobId);
		if (ack) {
			console.log(
				chalk.green("✓") +
				` ${chalk.cyan(ack.jobId)}` +
				` received (${chalk.yellow(ack.commandId)}): ` +
				chalk.bold(action)
			);
		} else {
			console.log(chalk.yellow(`⚠ Command sent but no ack received within timeout (jobId: ${jobId})`));
		}
	} catch (err) {
		if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
			console.error(chalk.red("Cannot connect to Grasshopper. Is Rhino open?"));
		} else {
			console.error(chalk.red("Publish failed:"), err);
		}
		process.exit(1);
	} finally {
		await publisher.close();
	}
}

async function waitForAck(jobId: string): Promise<{ jobId: string; commandId: string } | null> {
	const subscriber = new Subscriber();
	try {
		await subscriber.connect();
		await subscriber.subscribeTopic("gh.job.status");

		const deadline = Date.now() + COMMAND_ACK_TIMEOUT_MS;

		while (Date.now() < deadline) {
			try {
				const msg = await subscriber.receiveOne();
				if (msg?.type === "gh.job.status" && msg.jobId === jobId && msg.state === "queued") {
					return { jobId: msg.jobId, commandId: msg.commandId };
				}
			} catch {
				break;
			}
		}
		return null;
	} finally {
		await subscriber.close();
	}
}

function createReadlineInterface(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			resolve(answer.trim());
		});
	});
}

async function interactiveSubmit(): Promise<void> {
	const rl = createReadlineInterface();

	console.log(chalk.bold("\n🛠  Interactive Command Submission\n"));
	console.log("Available actions:");
	ACTIONS.forEach((a) => {
		console.log(
			`  ${chalk.cyan(String(a.id).padStart(2))}. ${chalk.white(a.label)} (${a.action})`
		);
	});
	console.log("  " + chalk.cyan(" 0") + ". " + chalk.gray("Exit"));

	try {
		while (true) {
			const actionIdStr = await question(rl, chalk.yellow("\nSelect action (0-12): "));
			const actionId = parseInt(actionIdStr, 10);

			if (actionId === 0) {
				console.log(chalk.gray("Bye!"));
				break;
			}

			const selected = ACTIONS.find((a) => a.id === actionId);
			if (!selected) {
				console.log(chalk.red("Invalid selection. Try again."));
				continue;
			}

		const def = ACTION_REGISTRY.find((a) => a.action === selected.action);
			if (!def) {
				console.log(chalk.red("Invalid selection. Try again."));
				continue;
			}

			const params: Record<string, string> = {};

			for (const param of def.params) {
				params[param.name] = await question(rl, param.prompt);
			}

			await submit(selected.action, params);
		}
	} finally {
		rl.close();
	}
}

export function createSubmitCommand(program: Command): void {
	const cmd = program
		.command("submit [action]")
		.description("Submit a command to Grasshopper")
		.option("--interactive", "Interactive mode with action selection", false);

	const seenFlags = new Set<string>();
	for (const def of ACTION_REGISTRY) {
		for (const param of def.params) {
			if (!seenFlags.has(param.cliFlag)) {
				seenFlags.add(param.cliFlag);
				cmd.option(param.cliFlag, param.cliDescription);
			}
		}
	}

	cmd.action(async (action: string | undefined, opts: Record<string, string>) => {
			try {
				if (opts.interactive || !action) {
					await interactiveSubmit();
				} else {
					await submit(action, opts);
				}
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

function getBaselinePath(): string {
	return path.join(os.homedir(), ".gh-diff-baseline.xml");
}

function readBaseline(): string | null {
	const p = getBaselinePath();
	if (fs.existsSync(p)) {
		return fs.readFileSync(p, "utf-8");
	}
	return null;
}

function writeBaseline(xml: string): void {
	fs.writeFileSync(getBaselinePath(), xml, "utf-8");
}

async function diffCommand(watch: boolean, verbose: boolean): Promise<void> {
	console.log(chalk.bold("Connecting to Grasshopper pub/sub...\n"));

	const subscriber = new Subscriber();
	await subscriber.connect();

	console.log(chalk.green("✓ Connected to PUB socket"));
	console.log("Waiting for gh.event.xml...\n");

	let baseline = readBaseline();
	if (baseline && !watch) {
		console.log(chalk.gray("Baseline found. Waiting for next XML snapshot to compare..."));
	} else if (!baseline) {
		console.log(chalk.gray("No baseline found. First snapshot will be saved as baseline."));
	}

	try {
		await subscriber.subscribe((msg: GhMessage) => {
			if (msg.type !== "gh.event.xml") return;

			const event = msg as GhEventXml;

			if (verbose) {
				const size = new TextEncoder().encode(event.xml).length;
				console.log(chalk.dim(`\n[${formatTimestamp(event.timestamp)}] XML received: ${size} chars`));
				try {
					const parsed = buildGhJson(event.xml);
					console.log(chalk.gray(JSON.stringify(parsed, null, 2)));
				} catch (parseErr) {
					console.log(chalk.red("Parse error:"), parseErr);
				}
				console.log();
			}

			if (!baseline) {
				baseline = event.xml;
				writeBaseline(event.xml);
				console.log(chalk.green("✓ Baseline saved.") + ` ${event.docName}`);
				if (!watch) {
					subscriber.close();
					process.exit(0);
				}
				return;
			}

			try {
				const prev = buildGhJson(baseline);
				const next = buildGhJson(event.xml);
				const diff = diffGh(prev, next);
				const summary = formatDiffSummary(diff);

				const ts = formatTimestamp(event.timestamp);
				const compCount = Object.keys(next.components).length;
				const wireCount = next.wires.length;

				console.log(chalk.dim(`\n── ${ts} — ${event.docName} (${compCount} components, ${wireCount} wires) ──`));
				if (summary === "(no changes)") {
					console.log(chalk.gray("  (no changes)"));
				} else {
					const lines = summary.split("\n");
					for (const line of lines) {
						if (line.startsWith("+") && !line.startsWith("++")) {
							console.log(chalk.green(line));
						} else if (line.startsWith("-") && !line.startsWith("--")) {
							console.log(chalk.red(line));
						} else if (line.startsWith("~")) {
							console.log(chalk.yellow(line));
						} else {
							console.log(chalk.gray(line));
						}
					}
				}

				baseline = event.xml;
				writeBaseline(event.xml);

				if (!watch) {
					subscriber.close();
					process.exit(0);
				}
			} catch (parseErr) {
				console.error(chalk.red("Parse error:"), parseErr);
				if (!watch) {
					subscriber.close();
					process.exit(1);
				}
			}
		});
	} catch (err) {
		console.error(chalk.red("Error:"), err);
		await subscriber.close();
		process.exit(1);
	}
}

export function createDiffCommand(program: Command): void {
	program
		.command("diff")
		.description("Diff GH document XML snapshots")
		.option("--watch", "Continuous mode: diff every new snapshot against previous", false)
		.option("--verbose", "Log raw XML to terminal", false)
		.action(async (opts: { watch?: boolean; verbose?: boolean }) => {
			try {
				await diffCommand(opts.watch ?? false, opts.verbose ?? false);
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

export function setupCommands(program: Command): void {
	createSubscribeCommand(program);
	createSubmitCommand(program);
	createDiffCommand(program);
}
