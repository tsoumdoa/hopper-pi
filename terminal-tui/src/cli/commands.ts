import { Command } from "commander";
import { createSubscribeCommand } from "./commands/subscribe.js";
import { createSubmitCommand } from "./commands/submit.js";
import { createDiffCommand } from "./commands/diff.js";
import { createListComponentsCommand } from "./commands/list-components.js";

export function setupCommands(program: Command): void {
	createSubscribeCommand(program);
	createSubmitCommand(program);
	createDiffCommand(program);
	createListComponentsCommand(program);
}
