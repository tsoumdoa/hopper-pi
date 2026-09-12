#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

let options;
try {
	({ values: options } = parseArgs({
		args: process.argv.slice(2).filter((arg) => arg !== "--"),
		options: {
			yes: { type: "boolean" },
			"open-rhino": { type: "boolean" },
			"build-only": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	}));
	if (options["build-only"] && options["open-rhino"]) throw new Error("--build-only cannot be combined with --open-rhino.");
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
if (options.help) {
	console.log(`Usage: pnpm build:install [options]

Build, verify, smoke-test, and install the local platform's Yak package.
Replaces the installed copy without prompting. Quit Rhino before installing.

  --open-rhino  Open Rhino after installation
  --build-only  Build and smoke-test without installing or stopping the host
  --help        Show this help`);
	process.exit(0);
}

const args = [];
for (const [option, windows] of [["yes", "-Yes"], ["open-rhino", "-OpenRhino"], ["build-only", "-BuildOnly"]]) {
	if (options[option]) args.push(process.platform === "win32" ? windows : `--${option}`);
}
let command;
let commandArgs;
if (process.platform === "darwin") {
	command = "bash";
	commandArgs = [fileURLToPath(new URL("./install-rhino-mac.sh", import.meta.url)), ...args];
} else if (process.platform === "win32") {
	command = "powershell";
	commandArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./install-rhino-win.ps1", import.meta.url)), ...args];
} else {
	console.error("Rhino installation requires macOS or Windows.");
	process.exit(1);
}
const result = spawnSync(command, commandArgs, { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
