import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Subscriber } from "../../infra/subscriber.js";
import type { GhMessage, GhEventXml } from "../../types/messages.js";
import { buildGhJson } from "../../services/parser.js";
import { diffGh, formatDiffSummary } from "../../services/differ.js";

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
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
