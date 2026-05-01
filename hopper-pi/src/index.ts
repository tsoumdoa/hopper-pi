import chalk from "chalk";
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { runOnce } from "./agent/run-once.js";
import { getModel } from "@mariozechner/pi-ai";

async function main() {
	console.log(chalk.bold("\n🚀 Pi Agent Headless Harness\n"));

	const { session } = await createAgentSession({
		model: getModel("minimax", "MiniMax-M2.7"),
	});

	console.log(chalk.gray("Session created. Sending prompt...\n"));

	session.subscribe((event) => {
		if (event.type === "message_update") {
			const { assistantMessageEvent } = event;
			if (assistantMessageEvent.type === "text_delta") {
				process.stdout.write(chalk.cyan(assistantMessageEvent.delta));
			}
		}
	});

	try {
		await runOnce(session, "say hi in 10 words");
		console.log(chalk.green("\n\n✓ Run completed successfully"));
	} catch (err) {
		console.error(chalk.red("\n✗ Run failed:"), err);
		process.exit(1);
	} finally {
		session.dispose();
	}
}

main();
