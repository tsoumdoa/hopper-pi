import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline";
import { nanoid } from "nanoid";
import { Subscriber } from "../../infra/subscriber.js";
import { Publisher } from "../../infra/publisher.js";
import { COMMAND_ACK_TIMEOUT_MS } from "../../infra/connection.js";
import type { CommandAction, CommandParams, SubmitJobRequest } from "../../types/commands.js";
import { ACTION_REGISTRY } from "../../domain/commands.js";

const ACTIONS = ACTION_REGISTRY.map(({ id, action, label }) => ({ id, action, label }));
const VALID_ACTIONS = new Set(ACTION_REGISTRY.map((a) => a.action));

function parseParams(action: CommandAction, opts: Record<string, string>): CommandParams {
	const def = ACTION_REGISTRY.find((a) => a.action === action);
	if (!def) throw new Error(`Unknown action: ${action}`);
	const params: Record<string, unknown> = {};
	for (const param of def.params) {
		const raw = opts[param.name];
		params[param.name] = param.parse ? param.parse(raw) : raw;
	}
	if ("x" in params && "y" in params) {
		(params as Record<string, unknown>).position = { x: params.x as number, y: params.y as number };
		delete (params as Record<string, unknown>).x;
		delete (params as Record<string,unknown>).y;
	}
	return params as unknown as CommandParams;
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
