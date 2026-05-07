import { Command } from "commander";
import chalk from "chalk";
import { withRequester } from "../../infra/request-helpers.js";
import { buildGhJson } from "../../services/parser.js";
import type { GetCurrentCanvasResponse } from "../../types/messages.js";

export async function getCanvas(): Promise<void> {
	console.log(chalk.bold("Requesting current canvas snapshot...\n"));

	const response = await withRequester<GetCurrentCanvasResponse>(async (requester) => {
		return requester.request<GetCurrentCanvasResponse>({
			type: "getCurrentCanvas",
		});
	});

	console.log(chalk.green(`✓ Received canvas snapshot (${response.docName})\n`));

	const json = buildGhJson(response.xml);
	console.log(JSON.stringify(json, null, 2));
}

export function createGetCanvasCommand(program: Command): void {
	program
		.command("get-canvas")
		.description("Get current Grasshopper canvas as parsed JSON (REQ/REP)")
		.action(async () => {
			try {
				await getCanvas();
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}
