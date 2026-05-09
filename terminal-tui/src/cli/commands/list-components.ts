import { Command } from "commander";
import chalk from "chalk";
import { withRequester } from "../../infra/request-helpers.js";
import type { ListAllComponentsResponse } from "../../types/messages.js";

export async function listComponents(): Promise<void> {
	console.log(chalk.bold("Requesting component list from Grasshopper...\n"));

	const response = await withRequester<ListAllComponentsResponse>(async (requester) => {
		return requester.request<ListAllComponentsResponse>({
			type: "listAllComponents",
		});
	});

	console.log(chalk.green(`✓ Received ${response.components.length} component types:\n`));
	console.log(JSON.stringify(response.components, null, 2));
}

export function createListComponentsCommand(program: Command): void {
	program
		.command("list-components")
		.description("List all available Grasshopper component types (REQ/REP)")
		.action(async () => {
			try {
				await listComponents();
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}
