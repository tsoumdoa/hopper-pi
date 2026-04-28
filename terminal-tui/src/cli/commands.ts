import { Command } from "commander";
import chalk from "chalk";
import { nanoid } from "nanoid";
import { Subscriber } from "../infra/subscriber.js";
import { Requester } from "../infra/requester.js";
import { REQUEST_TIMEOUT } from "../infra/connection.js";
import type { CommandAction, CommandParams, SubmitJobRequest } from "../domain/commands.js";
import type { GhMessage, GhJobStatus, GhEventXml, GhHello } from "../domain/messages.js";

const ACTIONS: Array<{ id: number; action: CommandAction; label: string }> = [
	{ id: 1, action: "addComponent", label: "add-component" },
	{ id: 2, action: "deleteComponent", label: "delete-component" },
	{ id: 3, action: "connectWire", label: "connect-wire" },
	{ id: 4, action: "disconnectWire", label: "disconnect-wire" },
	{ id: 5, action: "moveComponent", label: "move-component" },
	{ id: 6, action: "renameComponent", label: "rename-component" },
	{ id: 7, action: "setComponentLocked", label: "set-locked" },
	{ id: 8, action: "setComponentHidden", label: "set-hidden" },
	{ id: 9, action: "addGroup", label: "add-group" },
	{ id: 10, action: "removeFromGroup", label: "remove-from-group" },
	{ id: 11, action: "setSliderValue", label: "set-slider" },
	{ id: 12, action: "setPanelText", label: "set-panel" },
];

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function handleMessage(msg: GhMessage): void {
	if (msg.type === "gh.hello") {
		const hello = msg as GhHello;
		console.log(
			chalk.blue(`[${msg.type}]`) +
			` ${formatTimestamp(hello.timestamp)} — ` +
			chalk.green(hello.msg)
		);
	} else if (msg.type === "gh.job.status") {
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
	} else if (msg.type === "gh.event.xml") {
		const event = msg as GhEventXml;
		const size = new TextEncoder().encode(event.xml).length;
		console.log(
			chalk.blue(`[${msg.type}]`) +
			` ${formatTimestamp(event.timestamp)} — ` +
			`docName: ${event.docName} (${size} bytes)`
		);
	}
}

export async function subscribe(): Promise<void> {
	console.log(chalk.bold("Connecting to Grasshopper pub/sub...\n"));

	const subscriber = new Subscriber();
	await subscriber.connect();

	console.log(chalk.green("✓ Connected to PUB socket"));
	console.log("Listening for events...\n");

	try {
		await subscriber.subscribe(handleMessage);
	} catch (err) {
		console.error(chalk.red("Subscriber error:"), err);
	} finally {
		await subscriber.close();
	}
}

function buildCommandPrompt(actionId: number, params: Record<string, string>): string {
	const action = ACTIONS.find((a) => a.id === actionId);
	if (!action) return "";

	const lines: string[] = [];
	lines.push(chalk.bold("\nSelect action:"));
	ACTIONS.forEach((a) => {
		const marker = a.id === actionId ? ">" : " ";
		lines.push(`  ${marker} ${a.id}. ${a.label}`);
	});

	lines.push(chalk.bold("\nEnter parameters:"));
	switch (action.action) {
		case "addComponent":
			lines.push(`  component type: ${params.componentType || ""}`);
			lines.push(`  nickname: ${params.nickName || ""}`);
			lines.push(`  x position: ${params.x || ""}`);
			lines.push(`  y position: ${params.y || ""}`);
			break;
		case "deleteComponent":
			lines.push(`  target id: ${params.targetId || ""}`);
			break;
		case "connectWire":
		case "disconnectWire":
			lines.push(`  from component: ${params.fromComponent || ""}`);
			lines.push(`  from port: ${params.fromPort || ""}`);
			lines.push(`  to component: ${params.toComponent || ""}`);
			lines.push(`  to port: ${params.toPort || ""}`);
			break;
		case "moveComponent":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  x position: ${params.x || ""}`);
			lines.push(`  y position: ${params.y || ""}`);
			break;
		case "renameComponent":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  nickname: ${params.nickName || ""}`);
			break;
		case "setComponentLocked":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  locked (true/false): ${params.locked || ""}`);
			break;
		case "setComponentHidden":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  hidden (true/false): ${params.hidden || ""}`);
			break;
		case "addGroup":
		case "removeFromGroup":
			lines.push(`  component ids (comma-separated): ${params.componentIds || ""}`);
			lines.push(`  group name: ${params.groupName || ""}`);
			break;
		case "setSliderValue":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  value: ${params.value || ""}`);
			break;
		case "setPanelText":
			lines.push(`  target id: ${params.targetId || ""}`);
			lines.push(`  text: ${params.text || ""}`);
			break;
	}
	return lines.join("\n");
}

export function createSubscribeCommand(program: Command): void {
	program
		.command("subscribe")
		.description("Subscribe to Grasshopper pub/sub events")
		.action(async () => {
			try {
				await subscribe();
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

const VALID_ACTIONS = new Set<string>([
	"addComponent",
	"deleteComponent",
	"connectWire",
	"disconnectWire",
	"moveComponent",
	"renameComponent",
	"setComponentLocked",
	"setComponentHidden",
	"addGroup",
	"removeFromGroup",
	"setSliderValue",
	"setPanelText",
]);

function parseParams(action: CommandAction, opts: Record<string, string>): CommandParams {
	switch (action) {
		case "addComponent":
			return {
				componentType: opts.componentType,
				nickName: opts.nickName,
				position: {
					x: Number(opts.x),
					y: Number(opts.y),
				},
			};
		case "deleteComponent":
			return { targetId: opts.targetId };
		case "connectWire":
		case "disconnectWire":
			return {
				from: { componentId: opts.fromComponent, port: opts.fromPort },
				to: { componentId: opts.toComponent, port: opts.toPort },
			};
		case "moveComponent":
			return {
				targetId: opts.targetId,
				position: { x: Number(opts.x), y: Number(opts.y) },
			};
		case "renameComponent":
			return { targetId: opts.targetId, nickName: opts.nickName };
		case "setComponentLocked":
			return { targetId: opts.targetId, locked: opts.locked === "true" };
		case "setComponentHidden":
			return { targetId: opts.targetId, hidden: opts.hidden === "true" };
		case "addGroup":
		case "removeFromGroup":
			return {
				componentIds: opts.componentIds?.split(",").map((s) => s.trim()) ?? [],
				groupName: opts.groupName,
			};
		case "setSliderValue":
			return { targetId: opts.targetId, value: Number(opts.value) };
		case "setPanelText":
			return { targetId: opts.targetId, text: opts.text };
	}
}

export async function submit(action: string, opts: Record<string, string>): Promise<void> {
	if (!VALID_ACTIONS.has(action)) {
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

	const requester = new Requester();
	try {
		await requester.connect();
		const response = await requester.submitJob(request);

		if (response.status === "error") {
			console.error(chalk.red(`Error: ${response.error}`));
			process.exit(1);
		}

		console.log(
			chalk.green("✓") +
			` ${chalk.cyan(response.jobId)}` +
			` received (${chalk.yellow(response.commandId)}): ` +
			chalk.bold(action)
		);
	} catch (err) {
		if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
			console.error(chalk.red("Cannot connect to Grasshopper. Is Rhino open?"));
		} else {
			console.error(chalk.red("Request failed:"), err);
		}
		process.exit(1);
	} finally {
		await requester.close();
	}
}

export function createSubmitCommand(program: Command): void {
	program
		.command("submit <action>")
		.description("Submit a command to Grasshopper")
		.option("--componentType <type>", "Component type (addComponent)")
		.option("--nickName <name>", "Component nickname")
		.option("--targetId <id>", "Target component ID")
		.option("--fromComponent <id>", "Source component ID (wire commands)")
		.option("--fromPort <port>", "Source port name (wire commands)")
		.option("--toComponent <id>", "Destination component ID (wire commands)")
		.option("--toPort <port>", "Destination port name (wire commands)")
		.option("--x <number>", "X position")
		.option("--y <number>", "Y position")
		.option("--locked <boolean>", "Locked state (true/false)")
		.option("--hidden <boolean>", "Hidden state (true/false)")
		.option("--componentIds <ids>", "Component IDs, comma-separated")
		.option("--groupName <name>", "Group name")
		.option("--value <number>", "Slider value")
		.option("--text <text>", "Panel text")
		.action(async (action: string, opts: Record<string, string>) => {
			try {
				await submit(action, opts);
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

export function setupCommands(program: Command): void {
	createSubscribeCommand(program);
	createSubmitCommand(program);
}