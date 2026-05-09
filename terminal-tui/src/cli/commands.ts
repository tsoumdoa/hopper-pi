import { Command } from "commander";
import { createSubscribeCommand } from "./commands/subscribe.js";
import { createSubmitCommand } from "./commands/submit.js";
import { createDiffCommand } from "./commands/diff.js";
import { createListComponentsCommand } from "./commands/list-components.js";
import { createGetCanvasCommand } from "./commands/get-canvas.js";
import { createTestAddAllCommand } from "./commands/test-add-all-components.js";

export function setupCommands(program: Command): void {
	createSubscribeCommand(program);
	createSubmitCommand(program);
	createDiffCommand(program);
	createListComponentsCommand(program);
	createGetCanvasCommand(program);
	createTestAddAllCommand(program);
}
