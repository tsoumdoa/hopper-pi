import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs";
import { Subscriber } from "../../infra/subscriber.js";
import { DEBUG } from "../../infra/connection.js";
import type { GhMessage, GhJobStatus, GhEventXml } from "../../types/messages.js";

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
